import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import {
  accounts,
  apiKeys,
  plans,
  userMonthlyUsage,
  users,
} from "../src/db/schema.js";

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
let customPlanId: string | undefined;

after(async () => {
  if (createdAccountIds.length > 0) {
    const createdUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.accountId, createdAccountIds));
    const userIds = createdUsers.map((user) => user.id);

    if (userIds.length > 0) {
      await db
        .delete(userMonthlyUsage)
        .where(inArray(userMonthlyUsage.userId, userIds));
    }

    await db.delete(users).where(inArray(users.accountId, createdAccountIds));
    await db.delete(apiKeys).where(inArray(apiKeys.accountId, createdAccountIds));

    if (customPlanId) {
      await db.delete(plans).where(eq(plans.id, customPlanId));
    }

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

async function createTestUser(
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
  return response.json() as CreatedUser;
}

test("PATCH /users/:externalUserId/plan", async (t) => {
  const ownerAccount = await createTestAccount("Plan Change Owner");
  const otherAccount = await createTestAccount("Plan Change Other Tenant");
  const ownerUser = await createTestUser(ownerAccount.apiKey, "owner_user");
  await createTestUser(otherAccount.apiKey, "foreign_user");

  const [premiumPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        eq(plans.name, "Premium"),
        eq(plans.scope, "USER"),
        eq(plans.isPredefined, true),
      ),
    );
  const [accountPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        eq(plans.name, "Starter"),
        eq(plans.scope, "ACCOUNT"),
        eq(plans.isPredefined, true),
      ),
    );

  assert.ok(premiumPlan);
  assert.ok(accountPlan);

  const [otherCustomPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: otherAccount.account.id,
      name: "Other Tenant Custom User Plan",
      scope: "USER",
      monthlyAllowance: 5_000n,
      maxUnitsPerRequest: 50n,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  assert.ok(otherCustomPlan);
  customPlanId = otherCustomPlan.id;

  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  await db.insert(userMonthlyUsage).values({
    userId: ownerUser.user.id,
    monthStart,
    usedUnits: 37n,
  });

  await t.test("rejects a missing API key", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/owner_user/plan",
      payload: { planId: premiumPlan.id },
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("rejects an invalid API key", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/owner_user/plan",
      headers: { "x-api-key": "uq_live_invalid" },
      payload: { planId: premiumPlan.id },
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("rejects an invalid planId", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/owner_user/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: "not-a-uuid" },
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test("rejects an ACCOUNT-scoped plan", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/owner_user/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: accountPlan.id },
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test("does not expose another account's user", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/foreign_user/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: premiumPlan.id },
    });
    assert.equal(response.statusCode, 404);
  });

  await t.test("rejects another account's custom USER plan", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/users/owner_user/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: otherCustomPlan.id },
    });
    assert.equal(response.statusCode, 404);
  });

  await t.test(
    "changes Basic to predefined Premium without changing monthly usage",
    async () => {
      assert.equal(ownerUser.user.plan.name, "Basic");

      const response = await app.inject({
        method: "PATCH",
        url: "/users/owner_user/plan",
        headers: { "x-api-key": ownerAccount.apiKey },
        payload: { planId: premiumPlan.id },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json() as CreatedUser;
      assert.equal(body.user.id, ownerUser.user.id);
      assert.equal(body.user.externalUserId, "owner_user");
      assert.equal(body.user.plan.id, premiumPlan.id);
      assert.equal(body.user.plan.name, "Premium");

      const [storedUser] = await db
        .select({ currentPlanId: users.currentPlanId })
        .from(users)
        .where(eq(users.id, ownerUser.user.id));
      const [usage] = await db
        .select({ usedUnits: userMonthlyUsage.usedUnits })
        .from(userMonthlyUsage)
        .where(
          and(
            eq(userMonthlyUsage.userId, ownerUser.user.id),
            eq(userMonthlyUsage.monthStart, monthStart),
          ),
        );

      assert.ok(storedUser);
      assert.equal(storedUser.currentPlanId, premiumPlan.id);
      assert.ok(usage);
      assert.equal(usage.usedUnits, 37n);
    },
  );
});
