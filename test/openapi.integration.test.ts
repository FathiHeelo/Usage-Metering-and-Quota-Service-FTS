import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";

process.env.DATABASE_URL ??=
  "postgresql://unused:unused@127.0.0.1:1/openapi_contract_only";

const { buildApp } = await import("../src/app.js");

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, { security?: unknown[] }>>;
  components: {
    securitySchemes: {
      apiKey: { type: string; in: string; name: string };
    };
  };
}

let app: FastifyInstance;

before(async () => {
  app = buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
});

test("Swagger UI and OpenAPI contract", async (t) => {
  let document: OpenApiDocument;

  await t.test("serves Swagger UI without falling through to the SPA", async () => {
    const direct = await app.inject({ method: "GET", url: "/docs" });
    const response = await app.inject({ method: "GET", url: "/docs/" });

    assert.equal(direct.statusCode, 200);
    assert.match(direct.body, /swagger-ui/);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /text\/html/);
    assert.match(response.body, /Quota Service API Documentation/);
    assert.match(response.body, /swagger-ui/);
  });

  await t.test("serves a valid OpenAPI document with every implemented route", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    assert.equal(response.statusCode, 200);
    document = response.json() as OpenApiDocument;
    assert.match(document.openapi, /^3\./);

    const expectedOperations = [
      ["/health", "get"],
      ["/accounts", "post"],
      ["/me", "get"],
      ["/account/plan", "patch"],
      ["/users", "post"],
      ["/users/{externalUserId}/plan", "patch"],
      ["/plans", "get"],
      ["/plans", "post"],
      ["/plans/{planId}", "patch"],
      ["/usage/consume", "post"],
      ["/usage/account", "get"],
      ["/usage/users/{externalUserId}", "get"],
      ["/usage/history", "get"],
    ] as const;

    for (const [path, method] of expectedOperations) {
      assert.ok(document.paths[path]?.[method], `${method.toUpperCase()} ${path}`);
    }
  });

  await t.test("documents API-key auth while keeping public routes public", () => {
    assert.deepEqual(document.components.securitySchemes.apiKey, {
      type: "apiKey",
      in: "header",
      name: "x-api-key",
      description:
        "One-time-issued account API key. The raw key is never stored by the service.",
    });
    assert.deepEqual(document.paths["/health"]?.get?.security, []);
    assert.deepEqual(document.paths["/accounts"]?.post?.security, []);
    assert.equal(document.paths["/me"]?.get?.security, undefined);
  });

  await t.test("keeps health and account creation operational beside docs", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    const publicAccountRoute = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: { name: " " },
    });
    const unauthorized = await app.inject({ method: "GET", url: "/me" });

    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: "ok" });
    assert.equal(publicAccountRoute.statusCode, 400);
    assert.deepEqual(publicAccountRoute.json(), {
      error: "Invalid request body",
    });
    assert.equal(unauthorized.statusCode, 401);
    assert.deepEqual(unauthorized.json(), { error: "Unauthorized" });
  });
});
