import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accounts, apiKeys, plans } from "../../db/schema.js";
import type {
  ChangeAccountPlanInput,
  CreateAccountInput,
} from "./account.schema.js";

const API_KEY_PREFIX_BYTES = 6;
const API_KEY_SECRET_BYTES = 32;

export class StarterAccountPlanMissingError extends Error {
  constructor() {
    super("The predefined Starter ACCOUNT plan is missing");
    this.name = "StarterAccountPlanMissingError";
  }
}

export class AccountPlanNotAccessibleError extends Error {
  constructor() {
    super("Plan was not found or is not accessible");
    this.name = "AccountPlanNotAccessibleError";
  }
}

export class InvalidAccountPlanScopeError extends Error {
  constructor() {
    super("A USER plan cannot be assigned to an account");
    this.name = "InvalidAccountPlanScopeError";
  }
}

function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const prefix = `uq_live_${randomBytes(API_KEY_PREFIX_BYTES).toString("hex")}`;
  const secret = randomBytes(API_KEY_SECRET_BYTES).toString("base64url");
  const rawKey = `${prefix}_${secret}`;
  const hash = createHash("sha256").update(rawKey).digest("hex");

  return { rawKey, prefix, hash };
}

export async function createAccount(input: CreateAccountInput) {
  return db.transaction(async (tx) => {
    const [starterPlan] = await tx
      .select({ id: plans.id, name: plans.name })
      .from(plans)
      .where(
        and(
          eq(plans.name, "Starter"),
          eq(plans.scope, "ACCOUNT"),
          eq(plans.isPredefined, true),
        ),
      )
      .limit(1);

    if (!starterPlan) {
      throw new StarterAccountPlanMissingError();
    }

    const [account] = await tx
      .insert(accounts)
      .values({ name: input.name, currentPlanId: starterPlan.id })
      .returning({ id: accounts.id, name: accounts.name });

    if (!account) {
      throw new Error("Account insert did not return a row");
    }

    const generatedKey = generateApiKey();

    await tx.insert(apiKeys).values({
      accountId: account.id,
      keyPrefix: generatedKey.prefix,
      keyHash: generatedKey.hash,
    });

    return {
      account: {
        id: account.id,
        name: account.name,
        plan: starterPlan,
      },
      apiKey: generatedKey.rawKey,
    };
  });
}

export async function changeAccountPlan(
  accountId: string,
  input: ChangeAccountPlanInput,
) {
  return db.transaction(async (tx) => {
    // The account row is the first lock for every quota-affecting mutation.
    const [account] = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .for("update")
      .limit(1);

    if (!account) {
      throw new Error("Authenticated account was not found");
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
      throw new AccountPlanNotAccessibleError();
    }

    if (plan.scope !== "ACCOUNT") {
      throw new InvalidAccountPlanScopeError();
    }

    if (plan.ownerAccountId !== null && plan.ownerAccountId !== accountId) {
      throw new AccountPlanNotAccessibleError();
    }

    const [updatedAccount] = await tx
      .update(accounts)
      .set({ currentPlanId: plan.id })
      .where(eq(accounts.id, accountId))
      .returning({ id: accounts.id, name: accounts.name });

    if (!updatedAccount) {
      throw new Error("Authenticated account was not found");
    }

    return {
      account: {
        ...updatedAccount,
        plan: { id: plan.id, name: plan.name },
      },
    };
  });
}
