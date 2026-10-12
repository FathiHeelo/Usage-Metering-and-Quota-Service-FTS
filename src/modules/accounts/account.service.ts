import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accounts, apiKeys, plans } from "../../db/schema.js";
import type { CreateAccountInput } from "./account.schema.js";

const API_KEY_PREFIX_BYTES = 6;
const API_KEY_SECRET_BYTES = 32;

export class StarterAccountPlanMissingError extends Error {
  constructor() {
    super("The predefined Starter ACCOUNT plan is missing");
    this.name = "StarterAccountPlanMissingError";
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
