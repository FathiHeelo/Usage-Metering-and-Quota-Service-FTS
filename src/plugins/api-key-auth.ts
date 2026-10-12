import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { accounts, apiKeys } from "../db/schema.js";

export interface AuthenticatedAccount {
  id: string;
  name: string;
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
      })
      .from(apiKeys)
      .innerJoin(accounts, eq(apiKeys.accountId, accounts.id))
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (!match || match.revokedAt !== null) {
      reply.code(401).send(unauthorizedResponse);
      return;
    }

    request.authenticatedAccount = {
      id: match.accountId,
      name: match.accountName,
    };
  } catch (error: unknown) {
    request.log.error({ err: error }, "API key authentication failed");
    reply.code(500).send({ error: "Internal server error" });
  }
}
