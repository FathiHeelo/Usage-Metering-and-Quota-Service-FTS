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

interface UsageDecision {
  accepted: boolean;
  requestId: string;
  units: string;
  account: { used: string; remaining: string };
  user: { used: string; remaining: string };
  rejection?: {
    scope: "ACCOUNT" | "USER";
    rule: "MONTHLY_ALLOWANCE" | "MAX_UNITS_PER_REQUEST";
  };
}

interface Fixture {
  account: CreatedAccount;
  user: CreatedUser;
}

const app = buildApp({ logger: false });
const createdAccountIds: string[] = [];
let starterPlanId: string | undefined;
let basicPlanId: string | undefined;

function currentUtcMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
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

async function createFixture(
  label: string,
  accountLimits: { monthly: bigint; request: bigint },
  userLimits: { monthly: bigint; request: bigint },
): Promise<Fixture> {
  const accountResponse = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: `${label} Account` },
  });
  assert.equal(accountResponse.statusCode, 201);
  const account = accountResponse.json() as CreatedAccount;
  createdAccountIds.push(account.account.id);
  starterPlanId ??= account.account.plan.id;

  const externalUserId = `${label.toLowerCase().replaceAll(" ", "_")}_user`;
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
      name: `${label} Account Plan`,
      scope: "ACCOUNT",
      monthlyAllowance: accountLimits.monthly,
      maxUnitsPerRequest: accountLimits.request,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  const [userPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: account.account.id,
      name: `${label} User Plan`,
      scope: "USER",
      monthlyAllowance: userLimits.monthly,
      maxUnitsPerRequest: userLimits.request,
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

  return { account, user };
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

async function readUsage(fixture: Fixture) {
  const monthStart = currentUtcMonthStart();
  const [accountUsage] = await db
    .select({ usedUnits: accountMonthlyUsage.usedUnits })
    .from(accountMonthlyUsage)
    .where(
      and(
        eq(accountMonthlyUsage.accountId, fixture.account.account.id),
        eq(accountMonthlyUsage.monthStart, monthStart),
      ),
    );
  const [userUsage] = await db
    .select({ usedUnits: userMonthlyUsage.usedUnits })
    .from(userMonthlyUsage)
    .where(
      and(
        eq(userMonthlyUsage.userId, fixture.user.user.id),
        eq(userMonthlyUsage.monthStart, monthStart),
      ),
    );
  return { account: accountUsage?.usedUnits, user: userUsage?.usedUnits };
}

test("POST /usage/consume", async (t) => {
  const acceptedFixture = await createFixture(
    "Accepted",
    { monthly: 1_000n, request: 100n },
    { monthly: 1_000n, request: 100n },
  );
  const accountRequestFixture = await createFixture(
    "Account Request",
    { monthly: 1_000n, request: 5n },
    { monthly: 1_000n, request: 100n },
  );
  const userRequestFixture = await createFixture(
    "User Request",
    { monthly: 1_000n, request: 100n },
    { monthly: 1_000n, request: 5n },
  );
  const accountMonthlyFixture = await createFixture(
    "Account Monthly",
    { monthly: 5n, request: 100n },
    { monthly: 1_000n, request: 100n },
  );
  const userMonthlyFixture = await createFixture(
    "User Monthly",
    { monthly: 1_000n, request: 100n },
    { monthly: 5n, request: 100n },
  );
  const concurrentFixture = await createFixture(
    "Concurrent",
    { monthly: 100n, request: 10n },
    { monthly: 100n, request: 10n },
  );

  await t.test("accepts once, increments both counters, and stores the decision", async () => {
    const firstResponse = await consume(acceptedFixture, "accepted_001", 10);
    assert.equal(firstResponse.statusCode, 200);
    const firstDecision = firstResponse.json() as UsageDecision;
    assert.equal(firstDecision.accepted, true);
    assert.deepEqual(firstDecision.account, { used: "10", remaining: "990" });
    assert.deepEqual(firstDecision.user, { used: "10", remaining: "990" });

    const storedUsage = await readUsage(acceptedFixture);
    assert.deepEqual(storedUsage, { account: 10n, user: 10n });

    const [storedRequest] = await db
      .select({ status: usageRequests.status })
      .from(usageRequests)
      .where(
        and(
          eq(usageRequests.accountId, acceptedFixture.account.account.id),
          eq(usageRequests.requestId, "accepted_001"),
        ),
      );
    assert.equal(storedRequest?.status, "ACCEPTED");

    const retryResponse = await consume(acceptedFixture, "accepted_001", 10);
    assert.equal(retryResponse.statusCode, 200);
    assert.deepEqual(retryResponse.json(), firstDecision);
    assert.deepEqual(await readUsage(acceptedFixture), {
      account: 10n,
      user: 10n,
    });
  });

  await t.test("rejects account max-per-request without consuming", async () => {
    const response = await consume(accountRequestFixture, "account_req_001", 10);
    const decision = response.json() as UsageDecision;
    assert.equal(response.statusCode, 200);
    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.rejection, {
      scope: "ACCOUNT",
      rule: "MAX_UNITS_PER_REQUEST",
    });
    assert.deepEqual(await readUsage(accountRequestFixture), {
      account: 0n,
      user: 0n,
    });
  });

  await t.test("rejects user max-per-request without consuming", async () => {
    const response = await consume(userRequestFixture, "user_req_001", 10);
    const decision = response.json() as UsageDecision;
    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.rejection, {
      scope: "USER",
      rule: "MAX_UNITS_PER_REQUEST",
    });
    assert.deepEqual(await readUsage(userRequestFixture), {
      account: 0n,
      user: 0n,
    });
  });

  await t.test("rejects account monthly allowance without consuming", async () => {
    const response = await consume(accountMonthlyFixture, "account_month_001", 10);
    const decision = response.json() as UsageDecision;
    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.rejection, {
      scope: "ACCOUNT",
      rule: "MONTHLY_ALLOWANCE",
    });
    assert.deepEqual(await readUsage(accountMonthlyFixture), {
      account: 0n,
      user: 0n,
    });
  });

  await t.test("stores and replays a rejected user-monthly decision", async () => {
    const firstResponse = await consume(userMonthlyFixture, "user_month_001", 10);
    const firstDecision = firstResponse.json() as UsageDecision;
    assert.equal(firstDecision.accepted, false);
    assert.deepEqual(firstDecision.rejection, {
      scope: "USER",
      rule: "MONTHLY_ALLOWANCE",
    });

    const [storedRequest] = await db
      .select({ status: usageRequests.status })
      .from(usageRequests)
      .where(
        and(
          eq(usageRequests.accountId, userMonthlyFixture.account.account.id),
          eq(usageRequests.requestId, "user_month_001"),
        ),
      );
    assert.equal(storedRequest?.status, "REJECTED");

    const retryResponse = await consume(userMonthlyFixture, "user_month_001", 10);
    assert.deepEqual(retryResponse.json(), firstDecision);
    assert.deepEqual(await readUsage(userMonthlyFixture), {
      account: 0n,
      user: 0n,
    });
  });

  await t.test("returns 409 when a requestId is reused with different units", async () => {
    const response = await consume(acceptedFixture, "accepted_001", 11);
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: "Idempotency conflict" });
  });

  await t.test("does not resolve a user belonging to another account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/usage/consume",
      headers: { "x-api-key": acceptedFixture.account.apiKey },
      payload: {
        userId: accountRequestFixture.user.user.externalUserId,
        units: 1,
        requestId: "foreign_user_001",
      },
    });
    assert.equal(response.statusCode, 404);
  });

  await t.test("plan changes preserve usage and clamp remaining to zero", async () => {
    const [lowerPlan] = await db
      .insert(plans)
      .values({
        ownerAccountId: acceptedFixture.account.account.id,
        name: "Accepted Lowered Account Plan",
        scope: "ACCOUNT",
        monthlyAllowance: 5n,
        maxUnitsPerRequest: 100n,
        isPredefined: false,
      })
      .returning({ id: plans.id });
    assert.ok(lowerPlan);

    const planResponse = await app.inject({
      method: "PATCH",
      url: "/account/plan",
      headers: { "x-api-key": acceptedFixture.account.apiKey },
      payload: { planId: lowerPlan.id },
    });
    assert.equal(planResponse.statusCode, 200);
    assert.deepEqual(await readUsage(acceptedFixture), {
      account: 10n,
      user: 10n,
    });

    const response = await consume(acceptedFixture, "after_lowering_001", 1);
    const decision = response.json() as UsageDecision;
    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.rejection, {
      scope: "ACCOUNT",
      rule: "MONTHLY_ALLOWANCE",
    });
    assert.equal(decision.account.used, "10");
    assert.equal(decision.account.remaining, "0");
    assert.deepEqual(await readUsage(acceptedFixture), {
      account: 10n,
      user: 10n,
    });
  });

  await t.test("serializes concurrent requests without overspending", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        consume(concurrentFixture, `concurrent_${index}`, 10),
      ),
    );
    const decisions = responses.map(
      (response) => response.json() as UsageDecision,
    );

    assert.ok(responses.every((response) => response.statusCode === 200));
    assert.equal(decisions.filter((decision) => decision.accepted).length, 10);
    assert.equal(decisions.filter((decision) => !decision.accepted).length, 10);
    assert.deepEqual(await readUsage(concurrentFixture), {
      account: 100n,
      user: 100n,
    });
  });
});
