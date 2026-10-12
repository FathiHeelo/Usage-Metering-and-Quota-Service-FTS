import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, apiKeys } from "../src/db/schema.js";

interface CreateAccountResponse {
  account: { id: string; name: string };
  apiKey: string;
}

const app = buildApp({ logger: false });
let createdAccountId: string | undefined;

after(async () => {
  if (createdAccountId) {
    await db.delete(apiKeys).where(eq(apiKeys.accountId, createdAccountId));
    await db.delete(accounts).where(eq(accounts.id, createdAccountId));
  }

  await app.close();
  await pool.end();
});

test("API key authentication", async (t) => {
  let rawApiKey: string;

  await t.test("GET /health remains public", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  });

  await t.test("POST /accounts remains public", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: { name: "Authentication Test Account" },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json() as CreateAccountResponse;
    createdAccountId = body.account.id;
    rawApiKey = body.apiKey;
  });

  await t.test("GET /me without an API key returns 401", async () => {
    const response = await app.inject({ method: "GET", url: "/me" });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  });

  await t.test("GET /me with an invalid API key returns 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { "x-api-key": "uq_live_invalid" },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  });

  await t.test("GET /me with a valid API key returns its account", async () => {
    assert.ok(createdAccountId);
    assert.ok(rawApiKey);

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { "x-api-key": rawApiKey },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      account: {
        id: createdAccountId,
        name: "Authentication Test Account",
      },
    });
  });

  await t.test("GET /me with a revoked API key returns 401", async () => {
    assert.ok(createdAccountId);
    assert.ok(rawApiKey);

    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.accountId, createdAccountId));

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { "x-api-key": rawApiKey },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  });
});
