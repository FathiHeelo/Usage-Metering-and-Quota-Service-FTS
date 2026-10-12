import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/index.js";
import { plans, users } from "../../db/schema.js";
import type { CreateUserInput } from "./user.schema.js";

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
