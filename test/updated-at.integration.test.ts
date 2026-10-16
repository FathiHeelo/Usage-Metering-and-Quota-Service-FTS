import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, apiKeys, plans, users } from "../src/db/schema.js";

interface CreatedAccount {
  account: { id: string; plan: { id: string } };
  apiKey: string;
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];
let starterPlanId: string | undefined;
let basicPlanId: string | undefined;

after(async () => {
  if (createdAccountIds.length > 0) {
    if (starterPlanId) {
      await db.update(accounts).set({ currentPlanId: starterPlanId }).where(inArray(accounts.id, createdAccountIds));
    }
    if (basicPlanId) {
      await db.update(users).set({ currentPlanId: basicPlanId }).where(inArray(users.accountId, createdAccountIds));
    }
    await db.delete(users).where(inArray(users.accountId, createdAccountIds));
    await db.delete(apiKeys).where(inArray(apiKeys.accountId, createdAccountIds));
    await db.delete(plans).where(inArray(plans.ownerAccountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
  }
  await app.close();
  await pool.end();
});

test("mutable records advance updated_at and preserve created_at", async () => {
  const accountResponse = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: "Timestamp Regression Account" },
  });
  assert.equal(accountResponse.statusCode, 201);
  const account = accountResponse.json() as CreatedAccount;
  createdAccountIds.push(account.account.id);
  starterPlanId = account.account.plan.id;

  const userResponse = await app.inject({
    method: "POST",
    url: "/users",
    headers: { "x-api-key": account.apiKey },
    payload: { externalUserId: "timestamp_user" },
  });
  assert.equal(userResponse.statusCode, 201);
  const userId = userResponse.json().user.id as string;
  basicPlanId = userResponse.json().user.plan.id as string;

  const accountPlanResponse = await app.inject({
    method: "POST",
    url: "/plans",
    headers: { "x-api-key": account.apiKey },
    payload: { name: "Timestamp Account Plan", scope: "ACCOUNT", monthlyAllowance: 100, maxUnitsPerRequest: 20 },
  });
  const userPlanResponse = await app.inject({
    method: "POST",
    url: "/plans",
    headers: { "x-api-key": account.apiKey },
    payload: { name: "Timestamp User Plan", scope: "USER", monthlyAllowance: 50, maxUnitsPerRequest: 10 },
  });
  assert.equal(accountPlanResponse.statusCode, 201);
  assert.equal(userPlanResponse.statusCode, 201);
  const accountPlanId = accountPlanResponse.json().plan.id as string;
  const userPlanId = userPlanResponse.json().plan.id as string;

  const oldTimestamp = new Date("2001-01-01T00:00:00.000Z");
  await db.update(accounts).set({ updatedAt: oldTimestamp }).where(eq(accounts.id, account.account.id));
  await db.update(users).set({ updatedAt: oldTimestamp }).where(eq(users.id, userId));
  await db.update(plans).set({ updatedAt: oldTimestamp }).where(eq(plans.id, userPlanId));

  const [beforeAccount] = await db.select({ createdAt: accounts.createdAt }).from(accounts).where(eq(accounts.id, account.account.id));
  const [beforeUser] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  const [beforePlan] = await db.select({ createdAt: plans.createdAt }).from(plans).where(eq(plans.id, userPlanId));
  assert.ok(beforeAccount && beforeUser && beforePlan);

  assert.equal((await app.inject({
    method: "PATCH",
    url: "/account/plan",
    headers: { "x-api-key": account.apiKey },
    payload: { planId: accountPlanId },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "PATCH",
    url: "/users/timestamp_user/plan",
    headers: { "x-api-key": account.apiKey },
    payload: { planId: userPlanId },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "PATCH",
    url: `/plans/${userPlanId}`,
    headers: { "x-api-key": account.apiKey },
    payload: { monthlyAllowance: 75 },
  })).statusCode, 200);

  const [afterAccount] = await db.select({ createdAt: accounts.createdAt, updatedAt: accounts.updatedAt }).from(accounts).where(eq(accounts.id, account.account.id));
  const [afterUser] = await db.select({ createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(eq(users.id, userId));
  const [afterPlan] = await db.select({ createdAt: plans.createdAt, updatedAt: plans.updatedAt }).from(plans).where(eq(plans.id, userPlanId));
  assert.ok(afterAccount && afterUser && afterPlan);

  assert.ok(afterAccount.updatedAt > oldTimestamp);
  assert.ok(afterUser.updatedAt > oldTimestamp);
  assert.ok(afterPlan.updatedAt > oldTimestamp);
  assert.equal(afterAccount.createdAt.getTime(), beforeAccount.createdAt.getTime());
  assert.equal(afterUser.createdAt.getTime(), beforeUser.createdAt.getTime());
  assert.equal(afterPlan.createdAt.getTime(), beforePlan.createdAt.getTime());
});
