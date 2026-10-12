import { eq, isNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { plans } from "../../db/schema.js";
import type { CreatePlanInput, UpdatePlanInput } from "./plan.schema.js";

const DUPLICATE_CUSTOM_PLAN_CONSTRAINT =
  "plans_custom_owner_name_scope_unique";

export class PlanAlreadyExistsError extends Error {
  constructor() {
    super("A custom plan with this name and scope already exists");
    this.name = "PlanAlreadyExistsError";
  }
}

export class PlanNotAccessibleError extends Error {
  constructor() {
    super("Plan was not found or is not accessible");
    this.name = "PlanNotAccessibleError";
  }
}

export class PredefinedPlanReadOnlyError extends Error {
  constructor() {
    super("Predefined plans are read-only");
    this.name = "PredefinedPlanReadOnlyError";
  }
}

function isDuplicateCustomPlanError(error: unknown): boolean {
  let currentError: unknown = error;

  while (typeof currentError === "object" && currentError !== null) {
    const databaseError = currentError as {
      cause?: unknown;
      code?: unknown;
      constraint?: unknown;
    };

    if (
      databaseError.code === "23505" &&
      databaseError.constraint === DUPLICATE_CUSTOM_PLAN_CONSTRAINT
    ) {
      return true;
    }

    currentError = databaseError.cause;
  }

  return false;
}

function serializePlan(plan: {
  id: string;
  name: string;
  scope: "ACCOUNT" | "USER";
  monthlyAllowance: bigint;
  maxUnitsPerRequest: bigint;
  isPredefined: boolean;
}) {
  return {
    ...plan,
    monthlyAllowance: plan.monthlyAllowance.toString(),
    maxUnitsPerRequest: plan.maxUnitsPerRequest.toString(),
  };
}

const returnedPlanFields = {
  id: plans.id,
  name: plans.name,
  scope: plans.scope,
  monthlyAllowance: plans.monthlyAllowance,
  maxUnitsPerRequest: plans.maxUnitsPerRequest,
  isPredefined: plans.isPredefined,
};

export async function createPlan(accountId: string, input: CreatePlanInput) {
  try {
    const [plan] = await db
      .insert(plans)
      .values({
        ownerAccountId: accountId,
        name: input.name,
        scope: input.scope,
        monthlyAllowance: BigInt(input.monthlyAllowance),
        maxUnitsPerRequest: BigInt(input.maxUnitsPerRequest),
        isPredefined: false,
      })
      .returning(returnedPlanFields);

    if (!plan) {
      throw new Error("Plan insert did not return a row");
    }

    return { plan: serializePlan(plan) };
  } catch (error: unknown) {
    if (isDuplicateCustomPlanError(error)) {
      throw new PlanAlreadyExistsError();
    }

    throw error;
  }
}

export async function listAvailablePlans(accountId: string) {
  const availablePlans = await db
    .select(returnedPlanFields)
    .from(plans)
    .where(or(isNull(plans.ownerAccountId), eq(plans.ownerAccountId, accountId)))
    .orderBy(plans.scope, plans.name);

  return { plans: availablePlans.map(serializePlan) };
}

export async function updatePlan(
  accountId: string,
  planId: string,
  input: UpdatePlanInput,
) {
  const [existingPlan] = await db
    .select({
      ownerAccountId: plans.ownerAccountId,
      isPredefined: plans.isPredefined,
    })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  if (!existingPlan) {
    throw new PlanNotAccessibleError();
  }

  if (existingPlan.isPredefined) {
    throw new PredefinedPlanReadOnlyError();
  }

  if (existingPlan.ownerAccountId !== accountId) {
    throw new PlanNotAccessibleError();
  }

  const updates: {
    name?: string;
    monthlyAllowance?: bigint;
    maxUnitsPerRequest?: bigint;
  } = {};

  if (input.name !== undefined) {
    updates.name = input.name;
  }
  if (input.monthlyAllowance !== undefined) {
    updates.monthlyAllowance = BigInt(input.monthlyAllowance);
  }
  if (input.maxUnitsPerRequest !== undefined) {
    updates.maxUnitsPerRequest = BigInt(input.maxUnitsPerRequest);
  }

  try {
    const [plan] = await db
      .update(plans)
      .set(updates)
      .where(eq(plans.id, planId))
      .returning(returnedPlanFields);

    if (!plan) {
      throw new PlanNotAccessibleError();
    }

    return { plan: serializePlan(plan) };
  } catch (error: unknown) {
    if (isDuplicateCustomPlanError(error)) {
      throw new PlanAlreadyExistsError();
    }

    throw error;
  }
}
