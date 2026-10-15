import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
  users: CreatedUser[];
}

const app = buildApp({
  logger: false,
  accountCreationRateLimit: { max: 100, timeWindowMs: 60_000 },
});
const createdAccountIds: string[] = [];
const runId = Date.now().toString() + "_" + Math.random().toString(16).slice(2);
let fixtureSequence = 0;
let starterPlanId: string | undefined;
let basicPlanId: string | undefined;
let isolatedDatabaseVerified = false;

const failureTriggerName = "quota_edge_fail_usage_history_trigger";
const failureFunctionName = "quota_edge_fail_usage_history";

function utcMonthStart(date = new Date()): string {
  return (
    date.getUTCFullYear().toString() +
    "-" +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    "-01"
  );
}

before(async () => {
  assert.equal(
    process.env.QUOTA_EDGE_TEST_DATABASE,
    "1",
    "Set QUOTA_EDGE_TEST_DATABASE=1 only for a disposable quota edge-case database",
  );

  const databaseResult = await pool.query<{ databaseName: string }>(
    "SELECT current_database() AS \"databaseName\"",
  );
  assert.match(
    databaseResult.rows[0]?.databaseName ?? "",
    /^quota_edge_test(?:_|$)/,
    "Refusing to run destructive failure injection outside a quota_edge_test database",
  );

  isolatedDatabaseVerified = true;
});

async function removeHistoryFailureTrigger(): Promise<void> {
  await pool.query(
    "DROP TRIGGER IF EXISTS " +
      failureTriggerName +
      " ON usage_requests",
  );
  await pool.query(
    "DROP FUNCTION IF EXISTS " + failureFunctionName + "()",
  );
}

after(async () => {
  if (!isolatedDatabaseVerified) {
    await app.close();
    await pool.end();
    return;
  }

  await removeHistoryFailureTrigger();

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

async function createFixture(options: {
  userCount: number;
  accountMonthlyAllowance: bigint;
  accountMaxUnitsPerRequest: bigint;
  userMonthlyAllowance: bigint;
  userMaxUnitsPerRequest: bigint;
}): Promise<Fixture> {
  fixtureSequence += 1;
  const label = "edge_" + runId + "_" + fixtureSequence;
  const accountResponse = await app.inject({
    method: "POST",
    url: "/accounts",
    payload: { name: label + "_account" },
  });
  assert.equal(accountResponse.statusCode, 201, accountResponse.body);
  const account = accountResponse.json() as CreatedAccount;
  createdAccountIds.push(account.account.id);
  starterPlanId ??= account.account.plan.id;

  const createdUsers: CreatedUser[] = [];
  for (let index = 0; index < options.userCount; index += 1) {
    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: { "x-api-key": account.apiKey },
      payload: { externalUserId: label + "_user_" + (index + 1) },
    });
    assert.equal(userResponse.statusCode, 201, userResponse.body);
    const user = userResponse.json() as CreatedUser;
    basicPlanId ??= user.user.plan.id;
    createdUsers.push(user);
  }

  const [accountPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: account.account.id,
      name: label + "_account_plan",
      scope: "ACCOUNT",
      monthlyAllowance: options.accountMonthlyAllowance,
      maxUnitsPerRequest: options.accountMaxUnitsPerRequest,
      isPredefined: false,
    })
    .returning({ id: plans.id });
  const [userPlan] = await db
    .insert(plans)
    .values({
      ownerAccountId: account.account.id,
      name: label + "_user_plan",
      scope: "USER",
      monthlyAllowance: options.userMonthlyAllowance,
      maxUnitsPerRequest: options.userMaxUnitsPerRequest,
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
    .where(eq(users.accountId, account.account.id));

  return { account, users: createdUsers };
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
    payload: {
      userId: user.user.externalUserId,
      requestId,
      units,
    },
  });
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
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count " +
      "FROM pg_stat_activity " +
      "WHERE datname = current_database() " +
      "AND pid <> pg_backend_pid() " +
      "AND state = 'active' " +
      "AND wait_event_type = 'Lock'",
  );
  return result.rows[0]?.count ?? 0;
}

async function waitForLockWaiters(minimum: number): Promise<void> {
  const deadline = performance.now() + 5_000;

  while (performance.now() < deadline) {
    if ((await countLockWaiters()) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.fail("Timed out waiting for " + minimum + " blocked database operations");
}

async function readAccountUsage(accountId: string, monthStart: string) {
  return db
    .select({
      usedUnits: accountMonthlyUsage.usedUnits,
      updatedAt: accountMonthlyUsage.updatedAt,
    })
    .from(accountMonthlyUsage)
    .where(
      and(
        eq(accountMonthlyUsage.accountId, accountId),
        eq(accountMonthlyUsage.monthStart, monthStart),
      ),
    );
}

async function readUserUsage(userIds: string[], monthStart: string) {
  return db
    .select({
      userId: userMonthlyUsage.userId,
      usedUnits: userMonthlyUsage.usedUnits,
      updatedAt: userMonthlyUsage.updatedAt,
    })
    .from(userMonthlyUsage)
    .where(
      and(
        inArray(userMonthlyUsage.userId, userIds),
        eq(userMonthlyUsage.monthStart, monthStart),
      ),
    );
}

async function readHistory(accountId: string, requestId?: string) {
  const condition = requestId
    ? and(
        eq(usageRequests.accountId, accountId),
        eq(usageRequests.requestId, requestId),
      )
    : eq(usageRequests.accountId, accountId);

  return db
    .select({
      requestId: usageRequests.requestId,
      userId: usageRequests.userId,
      units: usageRequests.units,
      status: usageRequests.status,
      rejectionScope: usageRequests.rejectionScope,
      rejectionRule: usageRequests.rejectionRule,
      monthStart: usageRequests.monthStart,
      accountUsedAfter: usageRequests.accountUsedAfter,
    })
    .from(usageRequests)
    .where(condition);
}

async function installHistoryFailureTrigger(): Promise<void> {
  await removeHistoryFailureTrigger();
  await pool.query(
    "CREATE FUNCTION " +
      failureFunctionName +
      "() RETURNS trigger LANGUAGE plpgsql AS $body$ " +
      "BEGIN " +
      "IF NEW.request_id LIKE 'edge_rollback_failure_%' THEN " +
      "RAISE EXCEPTION 'injected usage history persistence failure'; " +
      "END IF; " +
      "RETURN NEW; " +
      "END; " +
      "$body$",
  );
  await pool.query(
    "CREATE TRIGGER " +
      failureTriggerName +
      " BEFORE INSERT ON usage_requests " +
      "FOR EACH ROW EXECUTE FUNCTION " +
      failureFunctionName +
      "()",
  );
}

test("quota concurrency and transaction edge cases", async (t) => {
  await t.test(
    "a request waiting across UTC rollover remains in its request-entry month",
    async (rolloverTest) => {
      const fixture = await createFixture({
        userCount: 1,
        accountMonthlyAllowance: 100n,
        accountMaxUnitsPerRequest: 100n,
        userMonthlyAllowance: 100n,
        userMaxUnitsPerRequest: 100n,
      });
      const beforeBoundary = Date.parse("2035-01-31T23:59:59.900Z");
      const afterBoundary = Date.parse("2035-02-01T00:00:00.100Z");
      const requestId = "edge_rollover_" + runId;
      const gate = await lockAccount(fixture.account.account.id);
      const baselineWaiters = await countLockWaiters();
      let response:
        | Awaited<ReturnType<typeof consume>>
        | undefined;

      rolloverTest.mock.timers.enable({
        apis: ["Date"],
        now: beforeBoundary,
      });

      try {
        const consumePromise = consume(
          fixture,
          fixture.users[0]!,
          requestId,
          5,
        );
        await waitForLockWaiters(baselineWaiters + 1);
        rolloverTest.mock.timers.setTime(afterBoundary);
        await gate.release();
        response = await consumePromise;
      } finally {
        rolloverTest.mock.timers.reset();
        await gate.cleanup();
      }

      assert.ok(response);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal((response.json() as UsageDecision).accepted, true);

      const januaryAccountRows = await readAccountUsage(
        fixture.account.account.id,
        "2035-01-01",
      );
      const januaryUserRows = await readUserUsage(
        [fixture.users[0]!.user.id],
        "2035-01-01",
      );
      const februaryAccountRows = await readAccountUsage(
        fixture.account.account.id,
        "2035-02-01",
      );
      const februaryUserRows = await readUserUsage(
        [fixture.users[0]!.user.id],
        "2035-02-01",
      );
      const history = await readHistory(
        fixture.account.account.id,
        requestId,
      );

      assert.equal(januaryAccountRows[0]?.usedUnits, 5n);
      assert.equal(januaryUserRows[0]?.usedUnits, 5n);
      assert.equal(januaryAccountRows[0]?.updatedAt.getTime(), afterBoundary);
      assert.equal(januaryUserRows[0]?.updatedAt.getTime(), afterBoundary);
      assert.equal(februaryAccountRows.length, 0);
      assert.equal(februaryUserRows.length, 0);
      assert.equal(history.length, 1);
      assert.equal(history[0]?.monthStart, "2035-01-01");
    },
  );

  await t.test(
    "concurrent conflicting payloads create one decision and return one 409",
    async () => {
      const fixture = await createFixture({
        userCount: 1,
        accountMonthlyAllowance: 100n,
        accountMaxUnitsPerRequest: 100n,
        userMonthlyAllowance: 100n,
        userMaxUnitsPerRequest: 100n,
      });
      const requestId = "edge_conflict_" + runId;
      const gate = await lockAccount(fixture.account.account.id);
      const baselineWaiters = await countLockWaiters();

      try {
        const firstPromise = consume(
          fixture,
          fixture.users[0]!,
          requestId,
          7,
        );
        await waitForLockWaiters(baselineWaiters + 1);
        const secondPromise = consume(
          fixture,
          fixture.users[0]!,
          requestId,
          11,
        );
        await waitForLockWaiters(baselineWaiters + 2);
        await gate.release();

        const responses = await Promise.all([firstPromise, secondPromise]);
        const successResponses = responses.filter(
          (response) => response.statusCode === 200,
        );
        const conflictResponses = responses.filter(
          (response) => response.statusCode === 409,
        );

        assert.equal(successResponses.length, 1);
        assert.equal(conflictResponses.length, 1);
        assert.deepEqual(conflictResponses[0]!.json(), {
          error: "Idempotency conflict",
        });

        const winningDecision =
          successResponses[0]!.json() as UsageDecision;
        assert.equal(winningDecision.accepted, true);
        const winningUnits = BigInt(winningDecision.units);
        const monthStart = utcMonthStart();
        const accountRows = await readAccountUsage(
          fixture.account.account.id,
          monthStart,
        );
        const userRows = await readUserUsage(
          [fixture.users[0]!.user.id],
          monthStart,
        );
        const history = await readHistory(
          fixture.account.account.id,
          requestId,
        );

        assert.equal(history.length, 1);
        assert.equal(history[0]?.units, winningUnits);
        assert.equal(history[0]?.status, "ACCEPTED");
        assert.equal(accountRows[0]?.usedUnits, winningUnits);
        assert.equal(userRows[0]?.usedUnits, winningUnits);
      } finally {
        await gate.cleanup();
      }
    },
  );

  await t.test(
    "different users cannot concurrently overspend their shared account quota",
    async () => {
      const fixture = await createFixture({
        userCount: 2,
        accountMonthlyAllowance: 10n,
        accountMaxUnitsPerRequest: 10n,
        userMonthlyAllowance: 100n,
        userMaxUnitsPerRequest: 10n,
      });
      const gate = await lockAccount(fixture.account.account.id);
      const baselineWaiters = await countLockWaiters();

      try {
        const firstPromise = consume(
          fixture,
          fixture.users[0]!,
          "edge_cross_user_first_" + runId,
          7,
        );
        await waitForLockWaiters(baselineWaiters + 1);
        const secondPromise = consume(
          fixture,
          fixture.users[1]!,
          "edge_cross_user_second_" + runId,
          7,
        );
        await waitForLockWaiters(baselineWaiters + 2);
        await gate.release();

        const responses = await Promise.all([firstPromise, secondPromise]);
        assert.ok(
          responses.every((response) => response.statusCode === 200),
        );
        const decisions = responses.map(
          (response) => response.json() as UsageDecision,
        );
        assert.equal(
          decisions.filter((decision) => decision.accepted).length,
          1,
        );
        assert.equal(
          decisions.filter((decision) => !decision.accepted).length,
          1,
        );
        assert.deepEqual(
          decisions.find((decision) => !decision.accepted)?.rejection,
          { scope: "ACCOUNT", rule: "MONTHLY_ALLOWANCE" },
        );

        const monthStart = utcMonthStart();
        const accountRows = await readAccountUsage(
          fixture.account.account.id,
          monthStart,
        );
        const userRows = await readUserUsage(
          fixture.users.map((user) => user.user.id),
          monthStart,
        );
        const history = await readHistory(fixture.account.account.id);
        const acceptedUnits = decisions
          .filter((decision) => decision.accepted)
          .reduce((sum, decision) => sum + BigInt(decision.units), 0n);
        const userUsageTotal = userRows.reduce(
          (sum, row) => sum + row.usedUnits,
          0n,
        );

        assert.equal(history.length, 2);
        assert.ok(
          history.every((decision) => decision.accountUsedAfter <= 10n),
        );
        assert.equal(accountRows[0]?.usedUnits, 7n);
        assert.ok((accountRows[0]?.usedUnits ?? 0n) <= 10n);
        assert.equal(accountRows[0]?.usedUnits, acceptedUnits);
        assert.equal(accountRows[0]?.usedUnits, userUsageTotal);
      } finally {
        await gate.cleanup();
      }
    },
  );

  await t.test(
    "history persistence failure rolls back counters and permits a clean retry",
    async () => {
      const fixture = await createFixture({
        userCount: 1,
        accountMonthlyAllowance: 100n,
        accountMaxUnitsPerRequest: 100n,
        userMonthlyAllowance: 100n,
        userMaxUnitsPerRequest: 100n,
      });
      const requestId = "edge_rollback_failure_" + runId;
      const monthStart = utcMonthStart();
      let failedResponse:
        | Awaited<ReturnType<typeof consume>>
        | undefined;

      await installHistoryFailureTrigger();
      try {
        failedResponse = await consume(
          fixture,
          fixture.users[0]!,
          requestId,
          9,
        );
      } finally {
        await removeHistoryFailureTrigger();
      }

      assert.ok(failedResponse);
      assert.equal(failedResponse.statusCode, 500);
      assert.deepEqual(failedResponse.json(), {
        error: "Internal server error",
      });

      assert.equal(
        (
          await readAccountUsage(
            fixture.account.account.id,
            monthStart,
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await readUserUsage(
            [fixture.users[0]!.user.id],
            monthStart,
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await readHistory(
            fixture.account.account.id,
            requestId,
          )
        ).length,
        0,
      );

      const retryResponse = await consume(
        fixture,
        fixture.users[0]!,
        requestId,
        9,
      );
      assert.equal(retryResponse.statusCode, 200, retryResponse.body);
      assert.equal((retryResponse.json() as UsageDecision).accepted, true);

      const accountRows = await readAccountUsage(
        fixture.account.account.id,
        monthStart,
      );
      const userRows = await readUserUsage(
        [fixture.users[0]!.user.id],
        monthStart,
      );
      const history = await readHistory(
        fixture.account.account.id,
        requestId,
      );
      assert.equal(accountRows[0]?.usedUnits, 9n);
      assert.equal(userRows[0]?.usedUnits, 9n);
      assert.equal(history.length, 1);
      assert.equal(history[0]?.status, "ACCEPTED");
      assert.equal(history[0]?.units, 9n);
    },
  );
});
