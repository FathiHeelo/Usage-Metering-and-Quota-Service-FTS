import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, apiKeys, plans, users } from "../src/db/schema.js";

interface CreatedAccount {
  account: { id: string };
  apiKey: string;
}

interface CreatedUser {
  user: {
    id: string;
    externalUserId: string;
    plan: { id: string; name: string };
  };
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];

after(async () => {
  if (createdAccountIds.length > 0) {
    await db.delete(users).where(inArray(users.accountId, createdAccountIds));
    await db.delete(apiKeys).where(inArray(apiKeys.accountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
  }

  await app.close();
  await pool.end();
});

async function createTestAccount(name: string): Promise<CreatedAccount> {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json() as CreatedAccount;
  createdAccountIds.push(body.account.id);
  return body;
}

test("POST /users", async (t) => {
  const firstAccount = await createTestAccount("First User Test Account");
  const secondAccount = await createTestAccount("Second User Test Account");
  const externalUserId = "user_001";

  await t.test("rejects a missing API key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { externalUserId },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  });

  await t.test("rejects an invalid API key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": "uq_live_invalid" },
      payload: { externalUserId },
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: "Unauthorized" });
  });

  await t.test("rejects an empty externalUserId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": firstAccount.apiKey },
      payload: { externalUserId: "   " },
    });

    assert.equal(response.statusCode, 400);
  });

  await t.test(
    "creates the user under the authenticated account with the Basic USER plan",
    async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users",
        headers: { "x-api-key": firstAccount.apiKey },
        payload: { externalUserId: `  ${externalUserId}  ` },
      });

      assert.equal(response.statusCode, 201);
      const body = response.json() as CreatedUser;
      assert.equal(body.user.externalUserId, externalUserId);
      assert.equal(body.user.plan.name, "Basic");

      const [storedUser] = await db
        .select({
          accountId: users.accountId,
          planId: users.currentPlanId,
          planName: plans.name,
          planScope: plans.scope,
          isPredefined: plans.isPredefined,
          ownerAccountId: plans.ownerAccountId,
        })
        .from(users)
        .innerJoin(plans, eq(users.currentPlanId, plans.id))
        .where(eq(users.id, body.user.id));

      assert.ok(storedUser);
      assert.equal(storedUser.accountId, firstAccount.account.id);
      assert.equal(storedUser.planId, body.user.plan.id);
      assert.equal(storedUser.planName, "Basic");
      assert.equal(storedUser.planScope, "USER");
      assert.equal(storedUser.isPredefined, true);
      assert.equal(storedUser.ownerAccountId, null);
    },
  );

  await t.test("rejects a duplicate externalUserId in one account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": firstAccount.apiKey },
      payload: { externalUserId },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: "User already exists" });
  });

  await t.test(
    "allows the same externalUserId in a different account",
    async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users",
        headers: { "x-api-key": secondAccount.apiKey },
        payload: { externalUserId },
      });

      assert.equal(response.statusCode, 201);
      const body = response.json() as CreatedUser;

      const [storedUser] = await db
        .select({ accountId: users.accountId })
        .from(users)
        .where(eq(users.id, body.user.id));

      assert.ok(storedUser);
      assert.equal(storedUser.accountId, secondAccount.account.id);
    },
  );
});
