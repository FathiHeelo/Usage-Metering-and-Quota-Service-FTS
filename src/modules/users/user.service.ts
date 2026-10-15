import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accounts, plans, users } from "../../db/schema.js";
import type {
  ChangeUserPlanInput,
  CreateUserInput,
} from "./user.schema.js";

const DUPLICATE_USER_CONSTRAINT = "users_account_external_user_unique";

export class BasicUserPlanMissingError extends Error {
  constructor() {
    super("The predefined Basic USER plan is missing");
    this.name = "BasicUserPlanMissingError";
  }
}

export class UserAlreadyExistsError extends Error {
  constructor() {
    super("User already exists in this account");
    this.name = "UserAlreadyExistsError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("User was not found in this account");
    this.name = "UserNotFoundError";
  }
}

export class PlanNotAccessibleError extends Error {
  constructor() {
    super("Plan was not found or is not accessible");
    this.name = "PlanNotAccessibleError";
  }
}

export class InvalidUserPlanScopeError extends Error {
  constructor() {
    super("An ACCOUNT plan cannot be assigned to a user");
    this.name = "InvalidUserPlanScopeError";
  }
}

function isDuplicateUserError(error: unknown): boolean {
  let currentError: unknown = error;

  while (typeof currentError === "object" && currentError !== null) {
    const databaseError = currentError as {
      cause?: unknown;
      code?: unknown;
      constraint?: unknown;
    };

    if (
      databaseError.code === "23505" &&
      databaseError.constraint === DUPLICATE_USER_CONSTRAINT
    ) {
      return true;
    }

    currentError = databaseError.cause;
  }

  return false;
}

export async function createUser(accountId: string, input: CreateUserInput) {
  const [basicPlan] = await db
    .select({ id: plans.id, name: plans.name })
    .from(plans)
    .where(
      and(
        eq(plans.name, "Basic"),
        eq(plans.scope, "USER"),
        eq(plans.isPredefined, true),
        isNull(plans.ownerAccountId),
      ),
    )
    .limit(1);

  if (!basicPlan) {
    throw new BasicUserPlanMissingError();
  }

  try {
    const [user] = await db
      .insert(users)
      .values({
        accountId,
        externalUserId: input.externalUserId,
        currentPlanId: basicPlan.id,
      })
      .returning({
        id: users.id,
        externalUserId: users.externalUserId,
      });

    if (!user) {
      throw new Error("User insert did not return a row");
    }

    return { user: { ...user, plan: basicPlan } };
  } catch (error: unknown) {
    if (isDuplicateUserError(error)) {
      throw new UserAlreadyExistsError();
    }

    throw error;
  }
}

export async function changeUserPlan(
  accountId: string,
  externalUserId: string,
  input: ChangeUserPlanInput,
) {
  return db.transaction(async (tx) => {
    // Quota mutations serialize on the account before locking a user.
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update")
      .limit(1);

    if (!account) {
      throw new Error("Authenticated account was not found");
    }

    const [user] = await tx
      .select({ id: users.id, externalUserId: users.externalUserId })
      .from(users)
      .where(
        and(
          eq(users.accountId, accountId),
          eq(users.externalUserId, externalUserId),
        ),
      )
      .for("update")
      .limit(1);

    if (!user) {
      throw new UserNotFoundError();
    }

    const [plan] = await tx
      .select({
        id: plans.id,
        name: plans.name,
        scope: plans.scope,
        ownerAccountId: plans.ownerAccountId,
      })
      .from(plans)
      .where(eq(plans.id, input.planId))
      .limit(1);

    if (!plan) {
      throw new PlanNotAccessibleError();
    }

    if (plan.scope !== "USER") {
      throw new InvalidUserPlanScopeError();
    }

    if (plan.ownerAccountId !== null && plan.ownerAccountId !== accountId) {
      throw new PlanNotAccessibleError();
    }

    const [updatedUser] = await tx
      .update(users)
      .set({ currentPlanId: plan.id })
      .where(and(eq(users.id, user.id), eq(users.accountId, accountId)))
      .returning({ id: users.id, externalUserId: users.externalUserId });

    if (!updatedUser) {
      throw new UserNotFoundError();
    }

    return {
      user: {
        ...updatedUser,
        plan: { id: plan.id, name: plan.name },
      },
    };
  });
}
