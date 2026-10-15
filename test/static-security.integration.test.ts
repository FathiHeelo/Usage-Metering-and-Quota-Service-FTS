import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/index.js";

const clientRoot = resolve(process.cwd(), "dist", "public");
const indexPath = resolve(clientRoot, "index.html");

assert.ok(
  existsSync(indexPath),
  "dist/public/index.html is required; run npm run build before this test",
);

const app = buildApp({ logger: false });

after(async () => {
  await app.close();
  await pool.end();
});

test("static application and API route security", async (t) => {
  await t.test("serves the React entry point and its built JavaScript", async () => {
    const indexResponse = await app.inject({ method: "GET", url: "/" });

    assert.equal(indexResponse.statusCode, 200);
    assert.match(indexResponse.headers["content-type"] ?? "", /^text\/html/);
    assert.match(indexResponse.body, /id="root"/);

    const builtIndex = readFileSync(indexPath, "utf8");
    const scriptPath = builtIndex.match(/src="([^"?]+\.js)"/)?.[1];
    assert.ok(scriptPath, "built index.html must reference a JavaScript asset");

    const scriptResponse = await app.inject({ method: "GET", url: scriptPath });
    assert.equal(scriptResponse.statusCode, 200);
    assert.match(
      scriptResponse.headers["content-type"] ?? "",
      /^(application|text)\/javascript/,
    );
  });

  await t.test("keeps public health and protected API routing intact", async () => {
    const healthResponse = await app.inject({ method: "GET", url: "/health" });
    const protectedResponse = await app.inject({
      method: "GET",
      url: "/usage/account",
    });

    assert.equal(healthResponse.statusCode, 200);
    assert.deepEqual(healthResponse.json(), { status: "ok" });
    assert.equal(protectedResponse.statusCode, 401);
    assert.deepEqual(protectedResponse.json(), { error: "Unauthorized" });
  });

  await t.test("does not bypass API authentication with non-canonical paths", async () => {
    const paths = [
      "/%75sage/account",
      "/usage/./account",
      "/assets/../usage/account",
      "/assets/%2e%2e/usage/account",
      "/usage%2Faccount",
      "/assets%2F..%2Fusage%2Faccount",
    ];

    for (const url of paths) {
      const response = await app.inject({ method: "GET", url });

      assert.ok(
        response.statusCode === 401 || response.statusCode === 404,
        `${url} unexpectedly returned HTTP ${response.statusCode}`,
      );
      assert.match(response.headers["content-type"] ?? "", /^application\/json/);
      assert.doesNotMatch(response.body, /id="root"/);
    }
  });
});
