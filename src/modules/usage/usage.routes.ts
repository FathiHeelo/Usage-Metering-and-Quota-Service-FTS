import type { FastifyPluginAsync } from "fastify";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import { consumeUsageSchema } from "./usage.schema.js";
import {
  consumeUsage,
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
};
