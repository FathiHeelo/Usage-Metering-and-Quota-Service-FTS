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

interface CreatedPlan {
  plan: {
    id: string;
    name: string;
    monthlyAllowance: string;
    maxUnitsPerRequest: string;
  };
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
  users: CreatedUser[];
  accountPlanId: string;
  userPlanId: string;
}

const app = buildApp({
  logger: false,
  accountCreationRateLimit: { max: 100, timeWindowMs: 60_000 },
});
const createdAccountIds: string[] = [];
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let fixtureSequence = 0;
let starterPlanId: string | undefined;
let basicPlanId: string | undefined;

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

async function createCustomPlan(
  account: CreatedAccount,
  name: string,
  scope: "ACCOUNT" | "USER",
  monthlyAllowance: number,
  maxUnitsPerRequest: number,
): Promise<CreatedPlan> {
  const response = await app.inject({
    method: "POST",
    url: "/plans",
    headers: { "x-api-key": account.apiKey },
    payload: { name, scope, monthlyAllowance, maxUnitsPerRequest },
  });

  assert.equal(response.statusCode, 201, response.body);
  return response.json() as CreatedPlan;
}

async function createFixture(userCount = 1): Promise<Fixture> {
  fixtureSequence += 1;
  const label = `pc_${runId}_${fixtureSequence}`;
  const accountResponse = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: `${label}_account` },
  });
  assert.equal(accountResponse.statusCode, 201, accountResponse.body);
  const account = accountResponse.json() as CreatedAccount;
  createdAccountIds.push(account.account.id);
  starterPlanId ??= account.account.plan.id;

  const createdUsers: CreatedUser[] = [];
  for (let index = 0; index < userCount; index += 1) {
    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": account.apiKey },
      payload: { externalUserId: `${label}_user_${index + 1}` },
    });
    assert.equal(userResponse.statusCode, 201, userResponse.body);
    const user = userResponse.json() as CreatedUser;
    basicPlanId ??= user.user.plan.id;
    createdUsers.push(user);
  }

  const accountPlan = await createCustomPlan(
    account,
    `${label}_account_plan`,
    "ACCOUNT",
    1_000,
    100,
  );
  const userPlan = await createCustomPlan(
    account,
    `${label}_user_plan`,
    "USER",
    1_000,
    100,
  );

  const accountPlanResponse = await app.inject({
    method: "PATCH",
    url: "/account/plan",
    headers: { "x-api-key": account.apiKey },
    payload: { planId: accountPlan.plan.id },
  });
  assert.equal(accountPlanResponse.statusCode, 200, accountPlanResponse.body);

  for (const user of createdUsers) {
    const userPlanResponse = await app.inject({
      method: "PATCH",
      url: `/users/${encodeURIComponent(user.user.externalUserId)}/plan`,
      headers: { "x-api-key": account.apiKey },
      payload: { planId: userPlan.plan.id },
    });
    assert.equal(userPlanResponse.statusCode, 200, userPlanResponse.body);
  }

  return {
    account,
    users: createdUsers,
    accountPlanId: accountPlan.plan.id,
    userPlanId: userPlan.plan.id,
  };
}

function consume(
  fixture: Fixture,
  user: CreatedUser,
  requestId: string,
  units: number,
) {
  return app.inject({
    method: "POST",
    url: "/usage/consume",
    headers: { "x-api-key": fixture.account.apiKey },
    payload: { userId: user.user.externalUserId, requestId, units },
  });
}

function changeUserPlan(
  fixture: Fixture,
  user: CreatedUser,
  planId: string,
) {
  return app.inject({
    method: "PATCH",
    url: `/users/${encodeURIComponent(user.user.externalUserId)}/plan`,
    headers: { "x-api-key": fixture.account.apiKey },
    payload: { planId },
  });
}

function changeAccountPlan(fixture: Fixture, planId: string) {
  return app.inject({
    method: "PATCH",
    url: "/account/plan",
    headers: { "x-api-key": fixture.account.apiKey },
    payload: { planId },
  });
}

function updatePlan(
  fixture: Fixture,
  planId: string,
  updates: { monthlyAllowance?: number; maxUnitsPerRequest?: number },
) {
  return app.inject({
    method: "PATCH",
    url: `/plans/${planId}`,
    headers: { "x-api-key": fixture.account.apiKey },
    payload: updates,
  });
}

async function readSnapshot(accountId: string, requestId: string) {
  const [exactSnapshot] = await db
    .select({
      accountPlanId: usageRequests.accountPlanId,
      userPlanId: usageRequests.userPlanId,
      accountMonthlyLimit: usageRequests.accountMonthlyLimit,
      userMonthlyLimit: usageRequests.userMonthlyLimit,
      status: usageRequests.status,
    })
    .from(usageRequests)
    .where(
      and(
        eq(usageRequests.accountId, accountId),
        eq(usageRequests.requestId, requestId),
      ),
    )
    .limit(1);

  assert.ok(exactSnapshot);
  return exactSnapshot;
}

async function lockAccount(accountId: string) {
  const client = await pool.connect();
  let open = true;

  await client.query("BEGIN");
  await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [
    accountId,
  ]);

  return {
    async release(): Promise<void> {
      if (!open) return;
      await client.query("COMMIT");
      open = false;
      client.release();
    },
    async cleanup(): Promise<void> {
      if (!open) return;
      await client.query("ROLLBACK");
      open = false;
      client.release();
    },
  };
}

async function countLockWaiters(): Promise<number> {
  const result = await pool.query<{ count: number }>(`
    SELECT count(*)::int AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state = 'active'
      AND wait_event_type = 'Lock'
  `);
  return result.rows[0]?.count ?? 0;
}

async function waitForLockWaiters(minimum: number): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if ((await countLockWaiters()) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.fail(`Timed out waiting for ${minimum} blocked database operations`);
}

test("plan changes and consumption use deterministic database ordering", async (t) => {
  await t.test("consume after a completed USER plan switch sees the new plan", async () => {
    const fixture = await createFixture();
    const user = fixture.users[0]!;
    const reducedPlan = await createCustomPlan(
      fixture.account,
      `completed_user_${runId}_${fixtureSequence}`,
      "USER",
      0,
      100,
    );

    const switchResponse = await changeUserPlan(
      fixture,
      user,
      reducedPlan.plan.id,
    );
    assert.equal(switchResponse.statusCode, 200, switchResponse.body);

    const response = await consume(fixture, user, `completed_user_${runId}`, 1);
    const decision = response.json() as UsageDecision;
    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.rejection, {
      scope: "USER",
      rule: "MONTHLY_ALLOWANCE",
    });

    const snapshot = await readSnapshot(
      fixture.account.account.id,
      `completed_user_${runId}`,
    );
    assert.equal(snapshot.userPlanId, reducedPlan.plan.id);
    assert.equal(snapshot.userMonthlyLimit, 0n);
  });

  await t.test("consume after a completed ACCOUNT plan switch sees the new plan", async () => {
    const fixture = await createFixture();
    const reducedPlan = await createCustomPlan(
      fixture.account,
      `completed_account_${runId}_${fixtureSequence}`,
      "ACCOUNT",
      0,
      100,
    );

    const switchResponse = await changeAccountPlan(fixture, reducedPlan.plan.id);
    assert.equal(switchResponse.statusCode, 200, switchResponse.body);

    const requestId = `completed_account_${runId}`;
    const response = await consume(fixture, fixture.users[0]!, requestId, 1);
    const decision = response.json() as UsageDecision;
    assert.equal(decision.accepted, false);
    assert.deepEqual(decision.rejection, {
      scope: "ACCOUNT",
      rule: "MONTHLY_ALLOWANCE",
    });

    const snapshot = await readSnapshot(fixture.account.account.id, requestId);
    assert.equal(snapshot.accountPlanId, reducedPlan.plan.id);
    assert.equal(snapshot.accountMonthlyLimit, 0n);
  });

  await t.test("consume after a completed custom-plan update sees new limits", async () => {
    const fixture = await createFixture();
    const updateResponse = await updatePlan(fixture, fixture.userPlanId, {
      monthlyAllowance: 0,
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.body);

    const requestId = `completed_update_${runId}`;
    const response = await consume(fixture, fixture.users[0]!, requestId, 1);
    const decision = response.json() as UsageDecision;
    assert.equal(decision.accepted, false);
    assert.equal(decision.rejection?.scope, "USER");

    const snapshot = await readSnapshot(fixture.account.account.id, requestId);
    assert.equal(snapshot.userPlanId, fixture.userPlanId);
    assert.equal(snapshot.userMonthlyLimit, 0n);
  });

  await t.test("a consume queued before a USER plan switch uses the old plan", async () => {
    const fixture = await createFixture();
    const user = fixture.users[0]!;
    const reducedPlan = await createCustomPlan(
      fixture.account,
      `queued_user_${runId}_${fixtureSequence}`,
      "USER",
      0,
      100,
    );
    const gate = await lockAccount(fixture.account.account.id);
    const baselineWaiters = await countLockWaiters();

    try {
      const requestId = `consume_first_${runId}`;
      const consumePromise = consume(fixture, user, requestId, 1);
      await waitForLockWaiters(baselineWaiters + 1);

      const switchPromise = changeUserPlan(fixture, user, reducedPlan.plan.id);
      await waitForLockWaiters(baselineWaiters + 2);
      await gate.release();

      const [consumeResponse, switchResponse] = await Promise.all([
        consumePromise,
        switchPromise,
      ]);
      assert.equal(consumeResponse.statusCode, 200, consumeResponse.body);
      assert.equal(switchResponse.statusCode, 200, switchResponse.body);
      assert.equal((consumeResponse.json() as UsageDecision).accepted, true);

      const snapshot = await readSnapshot(fixture.account.account.id, requestId);
      assert.equal(snapshot.userPlanId, fixture.userPlanId);
      assert.equal(snapshot.userMonthlyLimit, 1_000n);

      const laterResponse = await consume(
        fixture,
        user,
        `after_user_switch_${runId}`,
        1,
      );
      assert.equal((laterResponse.json() as UsageDecision).accepted, false);
    } finally {
      await gate.cleanup();
    }
  });

  await t.test("an ACCOUNT plan switch queued first controls the overlapping consume", async () => {
    const fixture = await createFixture();
    const reducedPlan = await createCustomPlan(
      fixture.account,
      `queued_account_${runId}_${fixtureSequence}`,
      "ACCOUNT",
      0,
      100,
    );
    const gate = await lockAccount(fixture.account.account.id);
    const baselineWaiters = await countLockWaiters();

    try {
      const switchPromise = changeAccountPlan(fixture, reducedPlan.plan.id);
      await waitForLockWaiters(baselineWaiters + 1);

      const requestId = `account_switch_first_${runId}`;
      const consumePromise = consume(fixture, fixture.users[0]!, requestId, 1);
      await waitForLockWaiters(baselineWaiters + 2);
      await gate.release();

      const [switchResponse, consumeResponse] = await Promise.all([
        switchPromise,
        consumePromise,
      ]);
      assert.equal(switchResponse.statusCode, 200, switchResponse.body);
      assert.equal(consumeResponse.statusCode, 200, consumeResponse.body);
      const decision = consumeResponse.json() as UsageDecision;
      assert.equal(decision.accepted, false);
      assert.equal(decision.rejection?.scope, "ACCOUNT");

      const snapshot = await readSnapshot(fixture.account.account.id, requestId);
      assert.equal(snapshot.accountPlanId, reducedPlan.plan.id);
      assert.equal(snapshot.accountMonthlyLimit, 0n);
    } finally {
      await gate.cleanup();
    }
  });

  await t.test("a shared custom-plan update serializes before both user decisions", async () => {
    const fixture = await createFixture(2);
    const gate = await lockAccount(fixture.account.account.id);
    const baselineWaiters = await countLockWaiters();

    try {
      const updatePromise = updatePlan(fixture, fixture.userPlanId, {
        monthlyAllowance: 0,
      });
      await waitForLockWaiters(baselineWaiters + 1);

      const firstRequestId = `shared_first_${runId}`;
      const firstConsumePromise = consume(
        fixture,
        fixture.users[0]!,
        firstRequestId,
        1,
      );
      await waitForLockWaiters(baselineWaiters + 2);

      const secondRequestId = `shared_second_${runId}`;
      const secondConsumePromise = consume(
        fixture,
        fixture.users[1]!,
        secondRequestId,
        1,
      );
      await waitForLockWaiters(baselineWaiters + 3);
      await gate.release();

      const [updateResponse, firstResponse, secondResponse] = await Promise.all([
        updatePromise,
        firstConsumePromise,
        secondConsumePromise,
      ]);
      assert.equal(updateResponse.statusCode, 200, updateResponse.body);
      assert.equal((firstResponse.json() as UsageDecision).accepted, false);
      assert.equal((secondResponse.json() as UsageDecision).accepted, false);

      const firstSnapshot = await readSnapshot(
        fixture.account.account.id,
        firstRequestId,
      );
      const secondSnapshot = await readSnapshot(
        fixture.account.account.id,
        secondRequestId,
      );
      assert.equal(firstSnapshot.userMonthlyLimit, 0n);
      assert.equal(secondSnapshot.userMonthlyLimit, 0n);
      assert.equal(firstSnapshot.userPlanId, fixture.userPlanId);
      assert.equal(secondSnapshot.userPlanId, fixture.userPlanId);
    } finally {
      await gate.cleanup();
    }
  });

  await t.test("a USER plan reduction queued first cannot be bypassed", async () => {
    const fixture = await createFixture();
    const user = fixture.users[0]!;
    const reducedPlan = await createCustomPlan(
      fixture.account,
      `reduction_${runId}_${fixtureSequence}`,
      "USER",
      0,
      100,
    );
    const gate = await lockAccount(fixture.account.account.id);
    const baselineWaiters = await countLockWaiters();

    try {
      const switchPromise = changeUserPlan(fixture, user, reducedPlan.plan.id);
      await waitForLockWaiters(baselineWaiters + 1);

      const requestId = `reduction_first_${runId}`;
      const consumePromise = consume(fixture, user, requestId, 1);
      await waitForLockWaiters(baselineWaiters + 2);
      await gate.release();

      const [switchResponse, consumeResponse] = await Promise.all([
        switchPromise,
        consumePromise,
      ]);
      assert.equal(switchResponse.statusCode, 200, switchResponse.body);
      const decision = consumeResponse.json() as UsageDecision;
      assert.equal(decision.accepted, false);
      assert.deepEqual(decision.rejection, {
        scope: "USER",
        rule: "MONTHLY_ALLOWANCE",
      });

      const snapshot = await readSnapshot(fixture.account.account.id, requestId);
      assert.equal(snapshot.userPlanId, reducedPlan.plan.id);
      assert.equal(snapshot.userMonthlyLimit, 0n);
    } finally {
      await gate.cleanup();
    }
  });

  await t.test("plan changes preserve existing account and user usage", async () => {
    const fixture = await createFixture();
    const user = fixture.users[0]!;
    const initialResponse = await consume(
      fixture,
      user,
      `preserved_initial_${runId}`,
      5,
    );
    assert.equal((initialResponse.json() as UsageDecision).accepted, true);

    const newAccountPlan = await createCustomPlan(
      fixture.account,
      `preserved_account_${runId}_${fixtureSequence}`,
      "ACCOUNT",
      500,
      50,
    );
    const newUserPlan = await createCustomPlan(
      fixture.account,
      `preserved_user_${runId}_${fixtureSequence}`,
      "USER",
      500,
      50,
    );

    assert.equal(
      (await changeAccountPlan(fixture, newAccountPlan.plan.id)).statusCode,
      200,
    );
    assert.equal(
      (await changeUserPlan(fixture, user, newUserPlan.plan.id)).statusCode,
      200,
    );
    assert.equal(
      (await updatePlan(fixture, newUserPlan.plan.id, {
        monthlyAllowance: 250,
      })).statusCode,
      200,
    );

    const accountUsage = await app.inject({
      method: "GET",
      url: "/usage/account",
      headers: { "x-api-key": fixture.account.apiKey },
    });
    const userUsage = await app.inject({
      method: "GET",
      url: `/usage/users/${encodeURIComponent(user.user.externalUserId)}`,
      headers: { "x-api-key": fixture.account.apiKey },
    });
    assert.equal(accountUsage.json().used, "5");
    assert.equal(userUsage.json().used, "5");
  });

  await t.test("idempotent retry keeps its original decision after a plan update", async () => {
    const fixture = await createFixture();
    const user = fixture.users[0]!;
    const requestId = `idempotent_original_${runId}`;
    const firstResponse = await consume(fixture, user, requestId, 5);
    const firstDecision = firstResponse.json() as UsageDecision;
    assert.equal(firstDecision.accepted, true);

    const updateResponse = await updatePlan(fixture, fixture.userPlanId, {
      monthlyAllowance: 0,
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.body);

    const retryResponse = await consume(fixture, user, requestId, 5);
    assert.deepEqual(retryResponse.json(), firstDecision);

    const newResponse = await consume(
      fixture,
      user,
      `idempotent_new_${runId}`,
      1,
    );
    assert.equal((newResponse.json() as UsageDecision).accepted, false);
  });
});
