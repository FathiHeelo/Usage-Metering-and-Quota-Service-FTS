import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import {
  accountMonthlyUsage,
  accounts,
  apiKeys,
  plans,
  usageRequests,
  userMonthlyUsage,
  users,
} from "../src/db/schema.js";

interface ActivePlan {
  id: string;
  name: string;
  scope: "ACCOUNT" | "USER";
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
}

interface CreatedAccount {
  account: { id: string; name: string; plan: { id: string; name: string } };
  apiKey: string;
}

interface CreatedUser {
  user: { id: string; externalUserId: string; plan: { id: string; name: string } };
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];
let starterPlanId: string | undefined;
let basicPlanId: string | undefined;

async function createAccount(name: string): Promise<CreatedAccount> {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json() as CreatedAccount;
  createdAccountIds.push(body.account.id);
  starterPlanId ??= body.account.plan.id;
  return body;
}

async function createUser(
  apiKey: string,
  externalUserId: string,
): Promise<CreatedUser> {
  const response = await app.inject({
    method: "POST",
    url: "/users",
    headers: { "x-api-key": apiKey },
    payload: { externalUserId },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json() as CreatedUser;
  basicPlanId ??= body.user.plan.id;
  return body;
}

after(async () => {
  if (createdAccountIds.length > 0) {
    const createdUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.accountId, createdAccountIds));
    const userIds = createdUsers.map((user) => user.id);

    await db
      .delete(usageRequests)
      .where(inArray(usageRequests.accountId, createdAccountIds));
    await db
      .delete(accountMonthlyUsage)
      .where(inArray(accountMonthlyUsage.accountId, createdAccountIds));
    if (userIds.length > 0) {
      await db
        .delete(userMonthlyUsage)
        .where(inArray(userMonthlyUsage.userId, userIds));
    }
    if (starterPlanId) {
      await db
        .update(accounts)
        .set({ currentPlanId: starterPlanId })
        .where(inArray(accounts.id, createdAccountIds));
    }
    if (basicPlanId) {
      await db
        .update(users)
        .set({ currentPlanId: basicPlanId })
        .where(inArray(users.accountId, createdAccountIds));
    }
    await db.delete(users).where(inArray(users.accountId, createdAccountIds));
    await db.delete(apiKeys).where(inArray(apiKeys.accountId, createdAccountIds));
    await db
      .delete(plans)
      .where(inArray(plans.ownerAccountId, createdAccountIds));
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
  }

  await app.close();
  await pool.end();
});

test("active plan read responses", async (t) => {
  const owner = await createAccount("Active Plan Owner");
  const other = await createAccount("Active Plan Other Tenant");
  const ownerUser = await createUser(owner.apiKey, "active_plan_user");
  await createUser(other.apiKey, "other_active_plan_user");

  await t.test("GET /me exposes the assigned account plan", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { "x-api-key": owner.apiKey },
    });

    assert.equal(response.statusCode, 200);
    const currentPlan = response.json().account.currentPlan as ActivePlan;
    assert.deepEqual(currentPlan, {
      id: owner.account.plan.id,
      name: "Starter",
      scope: "ACCOUNT",
      monthlyAllowance: "10000",
      maxUnitsPerRequest: "100",
    });
  });

  await t.test("user usage exposes the assigned Basic plan", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/usage/users/active_plan_user",
      headers: { "x-api-key": owner.apiKey },
    });

    assert.equal(response.statusCode, 200);
    const currentPlan = response.json().currentPlan as ActivePlan;
    assert.deepEqual(currentPlan, {
      id: ownerUser.user.plan.id,
      name: "Basic",
      scope: "USER",
      monthlyAllowance: "1000",
      maxUnitsPerRequest: "20",
    });
  });

  const accepted = await app.inject({
    method: "POST",
    url: "/usage/consume",
    headers: { "x-api-key": owner.apiKey },
    payload: {
      userId: ownerUser.user.externalUserId,
      units: 7,
      requestId: "active_plan_usage_001",
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().accepted, true);

  const accountPlanResponse = await app.inject({
    method: "POST",
    url: "/plans",
    headers: { "x-api-key": owner.apiKey },
    payload: {
      name: "Active Account Custom",
      scope: "ACCOUNT",
      monthlyAllowance: 70,
      maxUnitsPerRequest: 30,
    },
  });
  const userPlanResponse = await app.inject({
    method: "POST",
    url: "/plans",
    headers: { "x-api-key": owner.apiKey },
    payload: {
      name: "Active User Custom",
      scope: "USER",
      monthlyAllowance: 40,
      maxUnitsPerRequest: 15,
    },
  });
  assert.equal(accountPlanResponse.statusCode, 201);
  assert.equal(userPlanResponse.statusCode, 201);
  const accountPlan = accountPlanResponse.json().plan as ActivePlan;
  const userPlan = userPlanResponse.json().plan as ActivePlan;

  assert.equal((await app.inject({
    method: "PATCH",
    url: "/account/plan",
    headers: { "x-api-key": owner.apiKey },
    payload: { planId: accountPlan.id },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: "PATCH",
    url: "/users/active_plan_user/plan",
    headers: { "x-api-key": owner.apiKey },
    payload: { planId: userPlan.id },
  })).statusCode, 200);

  await t.test("plan switches are explicit and preserve existing usage", async () => {
    const [me, accountUsage, userUsage] = await Promise.all([
      app.inject({ method: "GET", url: "/me", headers: { "x-api-key": owner.apiKey } }),
      app.inject({ method: "GET", url: "/usage/account", headers: { "x-api-key": owner.apiKey } }),
      app.inject({ method: "GET", url: "/usage/users/active_plan_user", headers: { "x-api-key": owner.apiKey } }),
    ]);

    assert.equal(me.statusCode, 200);
    assert.equal(accountUsage.statusCode, 200);
    assert.equal(userUsage.statusCode, 200);
    assert.equal(me.json().account.currentPlan.id, accountPlan.id);
    assert.equal(accountUsage.json().currentPlan.id, accountPlan.id);
    assert.equal(userUsage.json().currentPlan.id, userPlan.id);
    assert.equal(accountUsage.json().used, "7");
    assert.equal(userUsage.json().used, "7");
  });

  await t.test("updated custom limits are returned without plan inference", async () => {
    const update = await app.inject({
      method: "PATCH",
      url: `/plans/${userPlan.id}`,
      headers: { "x-api-key": owner.apiKey },
      payload: { monthlyAllowance: 55, maxUnitsPerRequest: 22 },
    });
    assert.equal(update.statusCode, 200);

    const response = await app.inject({
      method: "GET",
      url: "/usage/users/active_plan_user",
      headers: { "x-api-key": owner.apiKey },
    });
    const body = response.json();
    assert.equal(body.currentPlan.id, userPlan.id);
    assert.equal(body.currentPlan.monthlyAllowance, "55");
    assert.equal(body.currentPlan.maxUnitsPerRequest, "22");
    assert.equal(body.used, "7");
  });

  await t.test("another tenant cannot read the owner's user plan", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/usage/users/active_plan_user",
      headers: { "x-api-key": other.apiKey },
    });
    assert.equal(response.statusCode, 404);
  });
});
