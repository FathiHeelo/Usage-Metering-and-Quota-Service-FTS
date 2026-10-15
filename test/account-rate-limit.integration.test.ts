import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, apiKeys } from "../src/db/schema.js";

interface CreateAccountResponse {
  account: { id: string; name: string };
}

const createdAccountIds: string[] = [];

after(async () => {
  if (createdAccountIds.length > 0) {
    await db
      .delete(apiKeys)
      .where(inArray(apiKeys.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
  }

  await pool.end();
});

async function createAccount(
  app: FastifyInstance,
  name: string,
  remoteAddress: string,
  forwardedFor: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    remoteAddress,
    headers: { "x-forwarded-for": forwardedFor },
    payload: { name },
  });

  if (response.statusCode === 201) {
    const body = response.json() as CreateAccountResponse;
    createdAccountIds.push(body.account.id);
  }

  return response;
}

test("POST /accounts rate limiting", async (t) => {
  await t.test(
    "allows registrations within the limit and rejects excess requests per forwarded client IP",
    async () => {
      const app = buildApp({
        logger: false,
        trustProxy: ["127.0.0.1"],
        accountCreationRateLimit: { max: 2, timeWindowMs: 60_000 },
      });

      try {
        const first = await createAccount(
          app,
          "Rate Limit Account One",
          "127.0.0.1",
          "198.51.100.10",
        );
        const second = await createAccount(
          app,
          "Rate Limit Account Two",
          "127.0.0.1",
          "198.51.100.10",
        );
        const exceeded = await createAccount(
          app,
          "Rate Limit Account Three",
          "127.0.0.1",
          "198.51.100.10",
        );
        const otherClient = await createAccount(
          app,
          "Different Client Account",
          "127.0.0.1",
          "198.51.100.11",
        );

        assert.equal(first.statusCode, 201);
        assert.equal(second.statusCode, 201);
        assert.equal(exceeded.statusCode, 429);
        assert.deepEqual(exceeded.json(), {
          statusCode: 429,
          error: "Too Many Requests",
          message:
            "Too many account creation requests. Please try again later.",
        });
        assert.match(exceeded.headers["retry-after"] ?? "", /^\d+$/);
        assert.equal(otherClient.statusCode, 201);
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    "ignores forwarded client headers from an untrusted direct connection",
    async () => {
      const app = buildApp({
        logger: false,
        trustProxy: ["127.0.0.1"],
        accountCreationRateLimit: { max: 1, timeWindowMs: 60_000 },
      });

      try {
        const first = await createAccount(
          app,
          "Untrusted Proxy Account",
          "203.0.113.20",
          "198.51.100.20",
        );
        const spoofed = await createAccount(
          app,
          "Spoofed Forwarded Address",
          "203.0.113.20",
          "198.51.100.21",
        );

        assert.equal(first.statusCode, 201);
        assert.equal(spoofed.statusCode, 429);
      } finally {
        await app.close();
      }
    },
  );
});
