import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, apiKeys, plans } from "../src/db/schema.js";

interface CreateAccountResponse {
  account: {
    id: string;
    name: string;
    plan: { id: string; name: string };
  };
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

test("POST /accounts creates an account on Starter and stores only the API-key hash", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: "DocuApp" },
  });

  assert.equal(response.statusCode, 201);

  const body = response.json() as CreateAccountResponse;
  createdAccountId = body.account.id;

  assert.equal(body.account.name, "DocuApp");
  assert.equal(body.account.plan.name, "Starter");
  assert.match(body.apiKey, /^uq_live_[a-f0-9]{12}_[A-Za-z0-9_-]{43}$/);

  const [storedAccount] = await db
    .select({
      currentPlanId: accounts.currentPlanId,
      planName: plans.name,
      planScope: plans.scope,
      isPredefined: plans.isPredefined,
    })
    .from(accounts)
    .innerJoin(plans, eq(accounts.currentPlanId, plans.id))
    .where(eq(accounts.id, body.account.id));

  assert.ok(storedAccount);
  assert.equal(storedAccount.currentPlanId, body.account.plan.id);
  assert.equal(storedAccount.planName, "Starter");
  assert.equal(storedAccount.planScope, "ACCOUNT");
  assert.equal(storedAccount.isPredefined, true);

  const [storedApiKey] = await db
    .select({ prefix: apiKeys.keyPrefix, hash: apiKeys.keyHash })
    .from(apiKeys)
    .where(eq(apiKeys.accountId, body.account.id));

  assert.ok(storedApiKey);
  assert.equal(storedApiKey.prefix, body.apiKey.slice(0, 20));
  assert.notEqual(storedApiKey.hash, body.apiKey);
  assert.equal(
    storedApiKey.hash,
    createHash("sha256").update(body.apiKey).digest("hex"),
  );
});

test("POST /accounts rejects an empty account name", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: "   " },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Invalid request body" });
});
