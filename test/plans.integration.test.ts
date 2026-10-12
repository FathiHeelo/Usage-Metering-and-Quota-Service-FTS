import "dotenv/config";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, pool } from "../src/db/index.js";
import { accounts, apiKeys, plans } from "../src/db/schema.js";

interface CreatedAccount {
  account: { id: string };
  apiKey: string;
}

interface PlanResponse {
  plan: {
    id: string;
    name: string;
    scope: "ACCOUNT" | "USER";
    monthlyAllowance: string;
    maxUnitsPerRequest: string;
    isPredefined: boolean;
  };
}

interface PlanListResponse {
  plans: PlanResponse["plan"][];
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];

after(async () => {
  if (createdAccountIds.length > 0) {
    await db
      .delete(plans)
      .where(inArray(plans.ownerAccountId, createdAccountIds));
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

async function createCustomPlan(
  apiKey: string,
  input: {
    name: string;
    scope: "ACCOUNT" | "USER";
    monthlyAllowance: number;
    maxUnitsPerRequest: number;
  },
): Promise<PlanResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/plans",
    headers: { "x-api-key": apiKey },
    payload: input,
  });
  assert.equal(response.statusCode, 201);
  return response.json() as PlanResponse;
}

test("custom plan management", async (t) => {
  const ownerAccount = await createTestAccount("Custom Plan Owner");
  const otherAccount = await createTestAccount("Custom Plan Other Tenant");
  let userPlan: PlanResponse;
  let accountPlan: PlanResponse;
  let otherPlan: PlanResponse;

  await t.test("creates an owned, non-predefined USER custom plan", async () => {
    userPlan = await createCustomPlan(ownerAccount.apiKey, {
      name: "Gold",
      scope: "USER",
      monthlyAllowance: 5_000,
      maxUnitsPerRequest: 100,
    });

    assert.equal(userPlan.plan.scope, "USER");
    assert.equal(userPlan.plan.isPredefined, false);
    assert.equal(userPlan.plan.monthlyAllowance, "5000");

    const [storedPlan] = await db
      .select({
        ownerAccountId: plans.ownerAccountId,
        isPredefined: plans.isPredefined,
      })
      .from(plans)
      .where(eq(plans.id, userPlan.plan.id));

    assert.ok(storedPlan);
    assert.equal(storedPlan.ownerAccountId, ownerAccount.account.id);
    assert.equal(storedPlan.isPredefined, false);
  });

  await t.test("creates an ACCOUNT custom plan", async () => {
    accountPlan = await createCustomPlan(ownerAccount.apiKey, {
      name: "Business",
      scope: "ACCOUNT",
      monthlyAllowance: 50_000,
      maxUnitsPerRequest: 500,
    });

    assert.equal(accountPlan.plan.scope, "ACCOUNT");
    assert.equal(accountPlan.plan.isPredefined, false);
  });

  await t.test("rejects a duplicate name in the same account and scope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/plans",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: {
        name: "Gold",
        scope: "USER",
        monthlyAllowance: 7_000,
        maxUnitsPerRequest: 120,
      },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: "Plan already exists" });
  });

  await t.test("rejects invalid limits", async () => {
    const negativeResponse = await app.inject({
      method: "POST",
      url: "/plans",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: {
        name: "Invalid Negative",
        scope: "USER",
        monthlyAllowance: -1,
        maxUnitsPerRequest: 10,
      },
    });
    const fractionalResponse = await app.inject({
      method: "POST",
      url: "/plans",
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: {
        name: "Invalid Fraction",
        scope: "USER",
        monthlyAllowance: 100,
        maxUnitsPerRequest: 1.5,
      },
    });

    assert.equal(negativeResponse.statusCode, 400);
    assert.equal(fractionalResponse.statusCode, 400);
  });

  await t.test("lists global and own plans but excludes another tenant's plan", async () => {
    otherPlan = await createCustomPlan(otherAccount.apiKey, {
      name: "Other Tenant Secret",
      scope: "USER",
      monthlyAllowance: 9_000,
      maxUnitsPerRequest: 90,
    });

    const response = await app.inject({
      method: "GET",
      url: "/plans",
      headers: { "x-api-key": ownerAccount.apiKey },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as PlanListResponse;
    const returnedIds = new Set(body.plans.map((plan) => plan.id));

    assert.ok(body.plans.some((plan) => plan.name === "Starter" && plan.isPredefined));
    assert.ok(body.plans.some((plan) => plan.name === "Basic" && plan.isPredefined));
    assert.ok(returnedIds.has(userPlan.plan.id));
    assert.ok(returnedIds.has(accountPlan.plan.id));
    assert.equal(returnedIds.has(otherPlan.plan.id), false);
  });

  await t.test("allows the owner to update only mutable custom-plan fields", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${userPlan.plan.id}`,
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: {
        name: "Gold Plus",
        monthlyAllowance: 8_000,
        maxUnitsPerRequest: 150,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as PlanResponse;
    assert.equal(body.plan.name, "Gold Plus");
    assert.equal(body.plan.scope, "USER");
    assert.equal(body.plan.monthlyAllowance, "8000");
    assert.equal(body.plan.maxUnitsPerRequest, "150");

    const [storedPlan] = await db
      .select({
        ownerAccountId: plans.ownerAccountId,
        scope: plans.scope,
        monthlyAllowance: plans.monthlyAllowance,
      })
      .from(plans)
      .where(eq(plans.id, userPlan.plan.id));

    assert.ok(storedPlan);
    assert.equal(storedPlan.ownerAccountId, ownerAccount.account.id);
    assert.equal(storedPlan.scope, "USER");
    assert.equal(storedPlan.monthlyAllowance, 8_000n);
  });

  await t.test("rejects updates to predefined plans with 403", async () => {
    const [predefinedPlan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.isPredefined, true))
      .limit(1);
    assert.ok(predefinedPlan);

    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${predefinedPlan.id}`,
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { name: "Changed Global Plan" },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {
      error: "Predefined plans are read-only",
    });
  });

  await t.test("hides another account's custom plan from updates", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${otherPlan.plan.id}`,
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { name: "Stolen Plan" },
    });

    assert.equal(response.statusCode, 404);
  });

  await t.test("does not allow scope to be changed", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/plans/${userPlan.plan.id}`,
      headers: { "x-api-key": ownerAccount.apiKey },
      payload: { scope: "ACCOUNT" },
    });

    assert.equal(response.statusCode, 400);
  });
});
