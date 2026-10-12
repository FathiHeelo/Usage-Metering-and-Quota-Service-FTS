import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import {
  accountMonthlyUsage,
  accounts,
  apiKeys,
  plans,
} from "../src/db/schema.js";

interface CreatedAccount {
  account: {
    id: string;
    name: string;
    plan: { id: string; name: string };
  };
  apiKey: string;
}

interface ChangedAccountPlan {
  account: {
    id: string;
    name: string;
    plan: { id: string; name: string };
  };
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];
let starterPlanId: string | undefined;

after(async () => {
  if (createdAccountIds.length > 0) {
    if (starterPlanId) {
      await db
        .update(accounts)
        .set({ currentPlanId: starterPlanId })
        .where(inArray(accounts.id, createdAccountIds));
    }

    await db
      .delete(accountMonthlyUsage)
      .where(inArray(accountMonthlyUsage.accountId, createdAccountIds));
    await db.delete(apiKeys).where(inArray(apiKeys.accountId, createdAccountIds));
    await db
      .delete(plans)
      .where(inArray(plans.ownerAccountId, createdAccountIds));
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
  starterPlanId ??= body.account.plan.id;
  return body;
}

test("PATCH /account/plan", async (t) => {
  const ownerAccount = await createTestAccount("Account Plan Owner");
  const otherAccount = await createTestAccount("Account Plan Other Tenant");

  const [proPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        eq(plans.name, "Pro"),
        eq(plans.scope, "ACCOUNT"),
        eq(plans.isPredefined, true),
      ),
    );
  const [userPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        eq(plans.name, "Basic"),
        eq(plans.scope, "USER"),
        eq(plans.isPredefined, true),
      ),
    );
  assert.ok(proPlan);
  assert.ok(userPlan);

  const [ownCustomPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: ownerAccount.account.id,
      name: "Owner Custom Account Plan",
      scope: "ACCOUNT",
      monthlyAllowance: 200_000n,
      maxUnitsPerRequest: 2_000n,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  const [otherCustomPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: otherAccount.account.id,
      name: "Other Custom Account Plan",
      scope: "ACCOUNT",
      monthlyAllowance: 300_000n,
      maxUnitsPerRequest: 3_000n,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  assert.ok(ownCustomPlan);
  assert.ok(otherCustomPlan);

  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  await db.insert(accountMonthlyUsage).values({
    accountId: ownerAccount.account.id,
    monthStart,
    usedUnits: 83n,
  });

  await t.test("rejects a missing API key", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      payload: { planId: proPlan.id },
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("rejects an invalid API key", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      headers: { "x-api-key": "uq_live_invalid" },
      payload: { planId: proPlan.id },
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("rejects an invalid planId", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: "not-a-uuid" },
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test("rejects a USER-scoped plan", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: userPlan.id },
    });
    assert.equal(response.statusCode, 400);
  });

  await t.test(
    "changes Starter to predefined Pro without changing account usage",
    async () => {
      assert.equal(ownerAccount.account.plan.name, "Starter");

      const response = await app.inject({
        method: "PATCH",
        url: "/account/plan",
        headers: { "x-api-key": ownerAccount.apiKey },
        payload: { planId: proPlan.id },
      });

      assert.equal(response.statusCode, 200);
      const body = response.json() as ChangedAccountPlan;
      assert.equal(body.account.id, ownerAccount.account.id);
      assert.equal(body.account.name, "Account Plan Owner");
      assert.equal(body.account.plan.id, proPlan.id);
      assert.equal(body.account.plan.name, "Pro");

      const [storedAccount] = await db
        .select({ currentPlanId: accounts.currentPlanId })
        .from(accounts)
        .where(eq(accounts.id, ownerAccount.account.id));
      const [usage] = await db
        .select({ usedUnits: accountMonthlyUsage.usedUnits })
        .from(accountMonthlyUsage)
        .where(
          and(
            eq(accountMonthlyUsage.accountId, ownerAccount.account.id),
            eq(accountMonthlyUsage.monthStart, monthStart),
          ),
        );

      assert.ok(storedAccount);
      assert.equal(storedAccount.currentPlanId, proPlan.id);
      assert.ok(usage);
      assert.equal(usage.usedUnits, 83n);
    },
  );

  await t.test("allows assignment of an owned custom ACCOUNT plan", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: ownCustomPlan.id },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as ChangedAccountPlan;
    assert.equal(body.account.plan.id, ownCustomPlan.id);
  });

  await t.test("rejects another account's custom ACCOUNT plan", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { planId: otherCustomPlan.id },
    });

    assert.equal(response.statusCode, 404);
  });
});
