import type { FastifyPluginAsync } from "fastify";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import { createAccountSchema } from "./account.schema.js";
import {
  createAccount,
  StarterAccountPlanMissingError,
} from "./account.service.js";

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.post("/accounts", async (request, reply) => {
    const parsedBody = createAccountSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }

    try {
      const result = await createAccount(parsedBody.data);
      return reply.code(201).send(result);
    } catch (error: unknown) {
      if (error instanceof StarterAccountPlanMissingError) {
        request.log.error({ err: error }, "Starter ACCOUNT plan is missing");
        return reply
          .code(500)
          .send({ error: "Starter ACCOUNT plan is not configured" });
      }

      request.log.error({ err: error }, "Failed to create account");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  app.get("/me", { preHandler: authenticateApiKey }, async (request, reply) => {
    if (!request.authenticatedAccount) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return { account: request.authenticatedAccount };
  });
};
