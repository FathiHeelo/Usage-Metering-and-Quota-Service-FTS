import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  accountMonthlyUsage,
  accounts,
  plans,
  usageRequests,
  userMonthlyUsage,
  users,
} from "../../db/schema.js";
import type {
  ConsumeUsageInput,
  UsageHistoryQuery,
  UsageMonthQuery,
} from "./usage.schema.js";

type QuotaScope = "ACCOUNT" | "USER";
type RejectionRule = "MONTHLY_ALLOWANCE" | "MAX_UNITS_PER_REQUEST";

interface DecisionSnapshot {
  requestId: string;
  units: bigint;
  status: "ACCEPTED" | "REJECTED";
  rejectionScope: QuotaScope | null;
  rejectionRule: RejectionRule | null;
  accountUsedAfter: bigint;
  accountRemainingAfter: bigint;
  userUsedAfter: bigint;
  userRemainingAfter: bigint;
}

export class UsageUserNotFoundError extends Error {
  constructor() {
    super("User was not found in this account");
    this.name = "UsageUserNotFoundError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The requestId was already used with different input");
    this.name = "IdempotencyConflictError";
  }
}

function currentUtcMonthStart(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-01`;
}

function resolveMonth(query: UsageMonthQuery): {
  month: string;
  monthStart: string;
} {
  const month = query.month ?? currentUtcMonthStart().slice(0, 7);
  return { month, monthStart: `${month}-01` };
}

function remaining(limit: bigint, used: bigint): bigint {
  const value = limit - used;
  return value > 0n ? value : 0n;
}

function formatDecision(snapshot: DecisionSnapshot) {
  const result = {
    accepted: snapshot.status === "ACCEPTED",
    requestId: snapshot.requestId,
    units: snapshot.units.toString(),
    account: {
      used: snapshot.accountUsedAfter.toString(),
      remaining: snapshot.accountRemainingAfter.toString(),
    },
    user: {
      used: snapshot.userUsedAfter.toString(),
      remaining: snapshot.userRemainingAfter.toString(),
    },
  };

  if (snapshot.status === "REJECTED") {
    return {
      ...result,
      rejection: {
        scope: snapshot.rejectionScope,
        rule: snapshot.rejectionRule,
      },
    };
  }

  return result;
}

function assertIdempotentInput(
  existing: { userId: string; units: bigint },
  userId: string,
  units: bigint,
): void {
  if (existing.userId !== userId || existing.units !== units) {
    throw new IdempotencyConflictError();
  }
}

export async function consumeUsage(accountId: string, input: ConsumeUsageInput) {
  const requestedUnits = BigInt(input.units);
  const monthStart = currentUtcMonthStart();

  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.accountId, accountId),
          eq(users.externalUserId, input.userId),
        ),
      )
      .limit(1);

    if (!user) {
      throw new UsageUserNotFoundError();
    }

    const findExistingDecision = async () => {
      const [existing] = await tx
        .select({
          userId: usageRequests.userId,
          requestId: usageRequests.requestId,
          units: usageRequests.units,
          status: usageRequests.status,
          rejectionScope: usageRequests.rejectionScope,
          rejectionRule: usageRequests.rejectionRule,
          accountUsedAfter: usageRequests.accountUsedAfter,
          accountRemainingAfter: usageRequests.accountRemainingAfter,
          userUsedAfter: usageRequests.userUsedAfter,
          userRemainingAfter: usageRequests.userRemainingAfter,
        })
        .from(usageRequests)
        .where(
          and(
            eq(usageRequests.accountId, accountId),
            eq(usageRequests.requestId, input.requestId),
          ),
        )
        .limit(1);

      return existing;
    };

    const existingDecision = await findExistingDecision();
    if (existingDecision) {
      assertIdempotentInput(existingDecision, user.id, requestedUnits);
      return formatDecision(existingDecision);
    }

    // Global quota-mutation lock order:
    // account -> user -> account monthly usage -> user monthly usage.
    // Account/user plan switches and custom-plan updates acquire the same
    // leading locks, so whichever transaction gets the account lock first
    // defines whether the old or new plan limits apply.
    const [lockedAccount] = await tx
      .select({ id: accounts.id, currentPlanId: accounts.currentPlanId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update")
      .limit(1);

    if (!lockedAccount) {
      throw new Error("Authenticated account could not be locked");
    }

    const [lockedUser] = await tx
      .select({ id: users.id, currentPlanId: users.currentPlanId })
      .from(users)
      .where(and(eq(users.id, user.id), eq(users.accountId, accountId)))
      .for("update")
      .limit(1);

    if (!lockedUser) {
      throw new UsageUserNotFoundError();
    }

    await tx
      .insert(accountMonthlyUsage)
      .values({ accountId, monthStart })
      .onConflictDoNothing();
    await tx
      .insert(userMonthlyUsage)
      .values({ userId: user.id, monthStart })
      .onConflictDoNothing();

    const [accountUsage] = await tx
      .select({ usedUnits: accountMonthlyUsage.usedUnits })
      .from(accountMonthlyUsage)
      .where(
        and(
          eq(accountMonthlyUsage.accountId, accountId),
          eq(accountMonthlyUsage.monthStart, monthStart),
        ),
      )
      .for("update")
      .limit(1);

    const [userUsage] = await tx
      .select({ usedUnits: userMonthlyUsage.usedUnits })
      .from(userMonthlyUsage)
      .where(
        and(
          eq(userMonthlyUsage.userId, user.id),
          eq(userMonthlyUsage.monthStart, monthStart),
        ),
      )
      .for("update")
      .limit(1);

    if (!accountUsage || !userUsage) {
      throw new Error("Monthly usage rows could not be locked");
    }

    const decisionAfterLock = await findExistingDecision();
    if (decisionAfterLock) {
      assertIdempotentInput(decisionAfterLock, user.id, requestedUnits);
      return formatDecision(decisionAfterLock);
    }

    const [accountPlan] = await tx
      .select({
        id: plans.id,
        monthlyAllowance: plans.monthlyAllowance,
        maxUnitsPerRequest: plans.maxUnitsPerRequest,
      })
      .from(plans)
      .where(eq(plans.id, lockedAccount.currentPlanId))
      .limit(1);
    const [userPlan] = await tx
      .select({
        id: plans.id,
        monthlyAllowance: plans.monthlyAllowance,
        maxUnitsPerRequest: plans.maxUnitsPerRequest,
      })
      .from(plans)
      .where(eq(plans.id, lockedUser.currentPlanId))
      .limit(1);

    if (!accountPlan || !userPlan) {
      throw new Error("Current quota plan could not be loaded");
    }

    let rejectionScope: QuotaScope | null = null;
    let rejectionRule: RejectionRule | null = null;

    if (requestedUnits > accountPlan.maxUnitsPerRequest) {
      rejectionScope = "ACCOUNT";
      rejectionRule = "MAX_UNITS_PER_REQUEST";
    } else if (requestedUnits > userPlan.maxUnitsPerRequest) {
      rejectionScope = "USER";
      rejectionRule = "MAX_UNITS_PER_REQUEST";
    } else if (
      accountUsage.usedUnits + requestedUnits >
      accountPlan.monthlyAllowance
    ) {
      rejectionScope = "ACCOUNT";
      rejectionRule = "MONTHLY_ALLOWANCE";
    } else if (
      userUsage.usedUnits + requestedUnits >
      userPlan.monthlyAllowance
    ) {
      rejectionScope = "USER";
      rejectionRule = "MONTHLY_ALLOWANCE";
    }

    const accepted = rejectionScope === null;
    const accountUsedAfter = accepted
      ? accountUsage.usedUnits + requestedUnits
      : accountUsage.usedUnits;
    const userUsedAfter = accepted
      ? userUsage.usedUnits + requestedUnits
      : userUsage.usedUnits;
    const accountRemainingAfter = remaining(
      accountPlan.monthlyAllowance,
      accountUsedAfter,
    );
    const userRemainingAfter = remaining(
      userPlan.monthlyAllowance,
      userUsedAfter,
    );

    if (accepted) {
      const updatedAt = new Date();
      await tx
        .update(accountMonthlyUsage)
        .set({ usedUnits: accountUsedAfter, updatedAt })
        .where(
          and(
            eq(accountMonthlyUsage.accountId, accountId),
            eq(accountMonthlyUsage.monthStart, monthStart),
          ),
        );
      await tx
        .update(userMonthlyUsage)
        .set({ usedUnits: userUsedAfter, updatedAt })
        .where(
          and(
            eq(userMonthlyUsage.userId, user.id),
            eq(userMonthlyUsage.monthStart, monthStart),
          ),
        );
    }

    const snapshot: DecisionSnapshot = {
      requestId: input.requestId,
      units: requestedUnits,
      status: accepted ? "ACCEPTED" : "REJECTED",
      rejectionScope,
      rejectionRule,
      accountUsedAfter,
      accountRemainingAfter,
      userUsedAfter,
      userRemainingAfter,
    };

    await tx.insert(usageRequests).values({
      accountId,
      userId: user.id,
      requestId: input.requestId,
      units: requestedUnits,
      status: snapshot.status,
      rejectionScope,
      rejectionRule,
      monthStart,
      accountPlanId: accountPlan.id,
      userPlanId: userPlan.id,
      accountMonthlyLimit: accountPlan.monthlyAllowance,
      accountRequestLimit: accountPlan.maxUnitsPerRequest,
      userMonthlyLimit: userPlan.monthlyAllowance,
      userRequestLimit: userPlan.maxUnitsPerRequest,
      accountUsedAfter,
      accountRemainingAfter,
      userUsedAfter,
      userRemainingAfter,
    });

    return formatDecision(snapshot);
  });
}

export async function getAccountUsage(
  accountId: string,
  query: UsageMonthQuery,
) {
  const { month, monthStart } = resolveMonth(query);
  const [account] = await db
    .select({
      id: accounts.id,
      planId: plans.id,
      planName: plans.name,
      planScope: plans.scope,
      monthlyAllowance: plans.monthlyAllowance,
      maxUnitsPerRequest: plans.maxUnitsPerRequest,
    })
    .from(accounts)
    .innerJoin(plans, eq(accounts.currentPlanId, plans.id))
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!account) {
    throw new Error("Authenticated account or current plan was not found");
  }

  const [usage] = await db
    .select({ usedUnits: accountMonthlyUsage.usedUnits })
    .from(accountMonthlyUsage)
    .where(
      and(
        eq(accountMonthlyUsage.accountId, accountId),
        eq(accountMonthlyUsage.monthStart, monthStart),
      ),
    )
    .limit(1);
  const used = usage?.usedUnits ?? 0n;

  return {
    accountId: account.id,
    month,
    used: used.toString(),
    monthlyLimit: account.monthlyAllowance.toString(),
    remaining: remaining(account.monthlyAllowance, used).toString(),
    currentPlan: {
      id: account.planId,
      name: account.planName,
      scope: account.planScope,
      monthlyAllowance: account.monthlyAllowance.toString(),
      maxUnitsPerRequest: account.maxUnitsPerRequest.toString(),
    },
  };
}

export async function getUserUsage(
  accountId: string,
  externalUserId: string,
  query: UsageMonthQuery,
) {
  const { month, monthStart } = resolveMonth(query);
  const [user] = await db
    .select({
      id: users.id,
      externalUserId: users.externalUserId,
      planId: plans.id,
      planName: plans.name,
      planScope: plans.scope,
      monthlyAllowance: plans.monthlyAllowance,
      maxUnitsPerRequest: plans.maxUnitsPerRequest,
    })
    .from(users)
    .innerJoin(plans, eq(users.currentPlanId, plans.id))
    .where(
      and(
        eq(users.accountId, accountId),
        eq(users.externalUserId, externalUserId),
      ),
    )
    .limit(1);

  if (!user) {
    throw new UsageUserNotFoundError();
  }

  const [usage] = await db
    .select({ usedUnits: userMonthlyUsage.usedUnits })
    .from(userMonthlyUsage)
    .where(
      and(
        eq(userMonthlyUsage.userId, user.id),
        eq(userMonthlyUsage.monthStart, monthStart),
      ),
    )
    .limit(1);
  const used = usage?.usedUnits ?? 0n;

  return {
    externalUserId: user.externalUserId,
    month,
    used: used.toString(),
    monthlyLimit: user.monthlyAllowance.toString(),
    remaining: remaining(user.monthlyAllowance, used).toString(),
    currentPlan: {
      id: user.planId,
      name: user.planName,
      scope: user.planScope,
      monthlyAllowance: user.monthlyAllowance.toString(),
      maxUnitsPerRequest: user.maxUnitsPerRequest.toString(),
    },
  };
}

export async function getUsageHistory(
  accountId: string,
  query: UsageHistoryQuery,
) {
  const conditions = [eq(usageRequests.accountId, accountId)];

  if (query.externalUserId !== undefined) {
    conditions.push(eq(users.externalUserId, query.externalUserId));
  }
  if (query.status !== undefined) {
    conditions.push(eq(usageRequests.status, query.status));
  }
  if (query.month !== undefined) {
    conditions.push(eq(usageRequests.monthStart, `${query.month}-01`));
  }

  const where = and(...conditions);
  const [totalRow] = await db
    .select({ total: count() })
    .from(usageRequests)
    .innerJoin(
      users,
      and(
        eq(usageRequests.userId, users.id),
        eq(usageRequests.accountId, users.accountId),
      ),
    )
    .where(where);
  const rows = await db
    .select({
      requestId: usageRequests.requestId,
      externalUserId: users.externalUserId,
      units: usageRequests.units,
      status: usageRequests.status,
      rejectionScope: usageRequests.rejectionScope,
      rejectionRule: usageRequests.rejectionRule,
      createdAt: usageRequests.createdAt,
      accountUsedAfter: usageRequests.accountUsedAfter,
      accountRemainingAfter: usageRequests.accountRemainingAfter,
      userUsedAfter: usageRequests.userUsedAfter,
      userRemainingAfter: usageRequests.userRemainingAfter,
    })
    .from(usageRequests)
    .innerJoin(
      users,
      and(
        eq(usageRequests.userId, users.id),
        eq(usageRequests.accountId, users.accountId),
      ),
    )
    .where(where)
    .orderBy(desc(usageRequests.createdAt), desc(usageRequests.id))
    .limit(query.limit)
    .offset((query.page - 1) * query.limit);

  return {
    items: rows.map((row) => ({
      requestId: row.requestId,
      externalUserId: row.externalUserId,
      units: row.units.toString(),
      status: row.status,
      rejection:
        row.status === "REJECTED"
          ? { scope: row.rejectionScope, rule: row.rejectionRule }
          : null,
      createdAt: row.createdAt.toISOString(),
      account: {
        usedAfter: row.accountUsedAfter.toString(),
        remainingAfter: row.accountRemainingAfter.toString(),
      },
      user: {
        usedAfter: row.userUsedAfter.toString(),
        remainingAfter: row.userRemainingAfter.toString(),
      },
    })),
    page: query.page,
    limit: query.limit,
    total: totalRow?.total ?? 0,
  };
}
