import type { FastifyPluginAsync } from "fastify";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import {
  changeUserPlanBodySchema,
  changeUserPlanParamsSchema,
  createUserSchema,
} from "./user.schema.js";
import {
  BasicUserPlanMissingError,
  changeUserPlan,
  createUser,
  InvalidUserPlanScopeError,
  PlanNotAccessibleError,
  UserAlreadyExistsError,
  UserNotFoundError,
} from "./user.service.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/users",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedBody = createUserSchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      try {
        const result = await createUser(
          request.authenticatedAccount.id,
          parsedBody.data,
        );
        return reply.code(201).send(result);
      } catch (error: unknown) {
        if (error instanceof UserAlreadyExistsError) {
          return reply.code(409).send({ error: "User already exists" });
        }

        if (error instanceof BasicUserPlanMissingError) {
          request.log.error({ err: error }, "Basic USER plan is missing");
          return reply.code(500).send({ error: "Internal server error" });
        }

        request.log.error({ err: error }, "Failed to create user");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );

  app.patch(
    "/users/:externalUserId/plan",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedParams = changeUserPlanParamsSchema.safeParse(request.params);
      const parsedBody = changeUserPlanBodySchema.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }

      try {
        const result = await changeUserPlan(
          request.authenticatedAccount.id,
          parsedParams.data.externalUserId,
          parsedBody.data,
        );
        return reply.code(200).send(result);
      } catch (error: unknown) {
        if (
          error instanceof UserNotFoundError ||
          error instanceof PlanNotAccessibleError
        ) {
          return reply.code(404).send({ error: "Not found" });
        }

        if (error instanceof InvalidUserPlanScopeError) {
          return reply
            .code(400)
            .send({ error: "Plan must have USER scope" });
        }

        request.log.error({ err: error }, "Failed to change user plan");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
};
