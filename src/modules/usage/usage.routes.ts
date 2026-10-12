import type { FastifyPluginAsync } from "fastify";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import {
  consumeUsageSchema,
  usageHistoryQuerySchema,
  usageMonthQuerySchema,
  userUsageParamsSchema,
} from "./usage.schema.js";
import {
  consumeUsage,
  getAccountUsage,
  getUsageHistory,
  getUserUsage,
  IdempotencyConflictError,
  UsageUserNotFoundError,
} from "./usage.service.js";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/usage/consume",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedBody = consumeUsageSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      try {
        const result = await consumeUsage(
          request.authenticatedAccount.id,
          parsedBody.data,
        );
        return reply.code(200).send(result);
      } catch (error: unknown) {
        if (error instanceof UsageUserNotFoundError) {
          return reply.code(404).send({ error: "User not found" });
        }

        if (error instanceof IdempotencyConflictError) {
          return reply.code(409).send({ error: "Idempotency conflict" });
        }

        request.log.error({ err: error }, "Failed to consume usage");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  app.get(
    "/usage/account",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedQuery = usageMonthQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: "Invalid query" });
      }

      try {
        return await getAccountUsage(
          request.authenticatedAccount.id,
          parsedQuery.data,
        );
      } catch (error: unknown) {
        request.log.error({ err: error }, "Failed to read account usage");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  app.get(
    "/usage/users/:externalUserId",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedParams = userUsageParamsSchema.safeParse(request.params);
      const parsedQuery = usageMonthQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }

      try {
        return await getUserUsage(
          request.authenticatedAccount.id,
          parsedParams.data.externalUserId,
          parsedQuery.data,
        );
      } catch (error: unknown) {
        if (error instanceof UsageUserNotFoundError) {
          return reply.code(404).send({ error: "User not found" });
        }

        request.log.error({ err: error }, "Failed to read user usage");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  app.get(
    "/usage/history",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedQuery = usageHistoryQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({ error: "Invalid query" });
      }

      try {
        return await getUsageHistory(
          request.authenticatedAccount.id,
          parsedQuery.data,
        );
      } catch (error: unknown) {
        request.log.error({ err: error }, "Failed to read usage history");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
};
