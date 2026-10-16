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

interface CreatedAccount {
  account: { id: string; plan: { id: string } };
  apiKey: string;
}

interface CreatedUser {
  user: { id: string; externalUserId: string; plan: { id: string } };
}

interface Fixture {
  account: CreatedAccount;
  user: CreatedUser;
  accountPlanId: string;
  userPlanId: string;
}

interface HistoryResponse {
  items: Array<{
    requestId: string;
    externalUserId: string;
    units: string;
    status: "ACCEPTED" | "REJECTED";
    rejection: { scope: string; rule: string } | null;
    account: { usedAfter: string; remainingAfter: string };
    user: { usedAfter: string; remainingAfter: string };
  }>;
  page: number;
  limit: number;
  total: number;
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];
let starterPlanId: string | undefined;
let basicPlanId: string | undefined;

function utcMonthOffset(offset: number): string {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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

async function createFixture(label: string): Promise<Fixture> {
  const accountResponse = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: `${label} Usage Read Account` },
  });
  assert.equal(accountResponse.statusCode, 201);
  const account = accountResponse.json() as CreatedAccount;
  createdAccountIds.push(account.account.id);
  starterPlanId ??= account.account.plan.id;

  const externalUserId = `${label.toLowerCase()}_history_user`;
  const userResponse = await app.inject({
    method: "POST",
    url: "/users",
    headers: { "x-api-key": account.apiKey },
    payload: { externalUserId },
  });
  assert.equal(userResponse.statusCode, 201);
  const user = userResponse.json() as CreatedUser;
  basicPlanId ??= user.user.plan.id;

  const [accountPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: account.account.id,
      name: `${label} Usage Read Account Plan`,
      scope: "ACCOUNT",
      monthlyAllowance: 100n,
      maxUnitsPerRequest: 10n,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  const [userPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: account.account.id,
      name: `${label} Usage Read User Plan`,
      scope: "USER",
      monthlyAllowance: 15n,
      maxUnitsPerRequest: 10n,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  assert.ok(accountPlan);
  assert.ok(userPlan);

  await db
    .update(accounts)
    .set({ currentPlanId: accountPlan.id })
    .where(eq(accounts.id, account.account.id));
  await db
    .update(users)
    .set({ currentPlanId: userPlan.id })
    .where(eq(users.id, user.user.id));

  return {
    account,
    user,
    accountPlanId: accountPlan.id,
    userPlanId: userPlan.id,
  };
}

async function consume(
  fixture: Fixture,
  requestId: string,
  units: number,
) {
  return app.inject({
    method: "POST",
    url: "/usage/consume",
    headers: { "x-api-key": fixture.account.apiKey },
    payload: {
      userId: fixture.user.user.externalUserId,
      units,
      requestId,
    },
  });
}

test("usage read APIs", async (t) => {
  const owner = await createFixture("Owner");
  const other = await createFixture("Other");
  const currentMonth = utcMonthOffset(0);
  const previousMonth = utcMonthOffset(-1);
  const emptyMonth = utcMonthOffset(-2);

  assert.equal((await consume(owner, "history_accepted", 10)).statusCode, 200);
  assert.equal((await consume(owner, "history_rejected", 10)).statusCode, 200);
  assert.equal((await consume(other, "other_history", 1)).statusCode, 200);

  await db.insert(accountMonthlyUsage).values({
    accountId: owner.account.account.id,
    monthStart: `${previousMonth}-01`,
    usedUnits: 7n,
  });
  await db.insert(userMonthlyUsage).values({
    userId: owner.user.user.id,
    monthStart: `${previousMonth}-01`,
    usedUnits: 4n,
  });

  await db
    .update(plans)
    .set({ monthlyAllowance: 5n })
    .where(eq(plans.id, owner.accountPlanId));

  await t.test("returns current account usage with remaining clamped to zero", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/usage/account",
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      accountId: owner.account.account.id,
      month: currentMonth,
      used: "10",
      monthlyLimit: "5",
      remaining: "0",
      currentPlan: {
        id: owner.accountPlanId,
        name: "Owner Usage Read Account Plan",
        scope: "ACCOUNT",
        monthlyAllowance: "5",
        maxUnitsPerRequest: "10",
      },
    });
  });

  await t.test("returns zero for an account month with no usage", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/usage/account?month=${emptyMonth}`,
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().used, "0");
    assert.equal(response.json().remaining, "5");
  });

  await t.test("returns current and previous user usage", async () => {
    const currentResponse = await app.inject({
      method: "GET",
      url: `/usage/users/${owner.user.user.externalUserId}`,
      headers: { "x-api-key": owner.account.apiKey },
    });
    const previousResponse = await app.inject({
      method: "GET",
      url: `/usage/users/${owner.user.user.externalUserId}?month=${previousMonth}`,
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(currentResponse.statusCode, 200);
    assert.deepEqual(currentResponse.json(), {
      externalUserId: owner.user.user.externalUserId,
      month: currentMonth,
      used: "10",
      monthlyLimit: "15",
      remaining: "5",
      currentPlan: {
        id: owner.userPlanId,
        name: "Owner Usage Read User Plan",
        scope: "USER",
        monthlyAllowance: "15",
        maxUnitsPerRequest: "10",
      },
    });
    assert.equal(previousResponse.statusCode, 200);
    assert.equal(previousResponse.json().month, previousMonth);
    assert.equal(previousResponse.json().used, "4");
  });

  await t.test("returns previous account month usage", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/usage/account?month=${previousMonth}`,
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().used, "7");
  });

  await t.test("does not expose another account's user", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/usage/users/${other.user.user.externalUserId}`,
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(response.statusCode, 404);
  });

  await t.test("returns only the account's accepted and rejected history", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/usage/history",
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as HistoryResponse;
    assert.equal(body.total, 2);
    assert.deepEqual(
      new Set(body.items.map((item) => item.requestId)),
      new Set(["history_accepted", "history_rejected"]),
    );
    assert.ok(body.items.some((item) => item.status === "ACCEPTED"));
    assert.ok(body.items.some((item) => item.status === "REJECTED"));
    assert.equal(body.items.some((item) => item.requestId === "other_history"), false);
  });

  await t.test("paginates history", async () => {
    const firstResponse = await app.inject({
      method: "GET",
      url: "/usage/history?page=1&limit=1",
      headers: { "x-api-key": owner.account.apiKey },
    });
    const secondResponse = await app.inject({
      method: "GET",
      url: "/usage/history?page=2&limit=1",
      headers: { "x-api-key": owner.account.apiKey },
    });
    const first = firstResponse.json() as HistoryResponse;
    const second = secondResponse.json() as HistoryResponse;

    assert.equal(first.total, 2);
    assert.equal(first.items.length, 1);
    assert.equal(second.items.length, 1);
    assert.notEqual(first.items[0]?.requestId, second.items[0]?.requestId);
  });

  await t.test("filters history by user, status, and month", async () => {
    const query = new URLSearchParams({
      externalUserId: owner.user.user.externalUserId,
      status: "REJECTED",
      month: currentMonth,
    });
    const response = await app.inject({
      method: "GET",
      url: `/usage/history?${query.toString()}`,
      headers: { "x-api-key": owner.account.apiKey },
    });
    const body = response.json() as HistoryResponse;

    assert.equal(response.statusCode, 200);
    assert.equal(body.total, 1);
    assert.equal(body.items[0]?.requestId, "history_rejected");
    assert.equal(body.items[0]?.status, "REJECTED");
  });

  await t.test("rejects an invalid month", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/usage/account?month=2026-13",
      headers: { "x-api-key": owner.account.apiKey },
    });

    assert.equal(response.statusCode, 400);
  });
});
