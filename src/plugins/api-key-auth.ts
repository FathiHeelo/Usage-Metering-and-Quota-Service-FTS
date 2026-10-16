import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { accounts, apiKeys, plans } from "../db/schema.js";

export interface ActivePlan {
  id: string;
  name: string;
  scope: "ACCOUNT" | "USER";
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
}

export interface AuthenticatedAccount {
  id: string;
  name: string;
  currentPlan: ActivePlan;
}

declare module "fastify" {
  interface FastifyRequest {
    authenticatedAccount: AuthenticatedAccount | null;
  }
}

const unauthorizedResponse = { error: "Unauthorized" } as const;

export function registerApiKeyAuth(app: FastifyInstance): void {
  app.decorateRequest("authenticatedAccount", null);
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const rawApiKey = request.headers["x-api-key"];

  if (typeof rawApiKey !== "string" || rawApiKey.length === 0) {
    reply.code(401).send(unauthorizedResponse);
    return;
  }

  const keyHash = createHash("sha256").update(rawApiKey).digest("hex");

  try {
    const [match] = await db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        revokedAt: apiKeys.revokedAt,
        planId: plans.id,
        planName: plans.name,
        planScope: plans.scope,
        monthlyAllowance: plans.monthlyAllowance,
        maxUnitsPerRequest: plans.maxUnitsPerRequest,
      })
      .from(apiKeys)
      .innerJoin(accounts, eq(apiKeys.accountId, accounts.id))
      .innerJoin(plans, eq(accounts.currentPlanId, plans.id))
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!match || match.revokedAt !== null) {
      reply.code(401).send(unauthorizedResponse);
      return;
    }

    request.authenticatedAccount = {
      id: match.accountId,
      name: match.accountName,
      currentPlan: {
        id: match.planId,
        name: match.planName,
        scope: match.planScope,
        monthlyAllowance: match.monthlyAllowance.toString(),
        maxUnitsPerRequest: match.maxUnitsPerRequest.toString(),
      },
    };
  } catch (error: unknown) {
    request.log.error({ err: error }, "API key authentication failed");
    reply.code(500).send({ error: "Internal server error" });
  }
}
