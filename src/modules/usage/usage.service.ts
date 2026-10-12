import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  accountMonthlyUsage,
  accounts,
  plans,
  usageRequests,
  userMonthlyUsage,
  users,
} from "../../db/schema.js";
import type { ConsumeUsageInput } from "./usage.schema.js";

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
      .select({ id: users.id, currentPlanId: users.currentPlanId })
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
      .from(accounts)
      .innerJoin(plans, eq(accounts.currentPlanId, plans.id))
      .where(eq(accounts.id, accountId))
      .limit(1);
    const [userPlan] = await tx
      .select({
        id: plans.id,
        monthlyAllowance: plans.monthlyAllowance,
        maxUnitsPerRequest: plans.maxUnitsPerRequest,
      })
      .from(plans)
      .where(eq(plans.id, user.currentPlanId))
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
