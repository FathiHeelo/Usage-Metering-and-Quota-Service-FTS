import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import {
  createPlanSchema,
  updatePlanParamsSchema,
  updatePlanSchema,
} from "./plan.schema.js";
import {
  createPlan,
  listAvailablePlans,
  PlanAlreadyExistsError,
  PlanNotAccessibleError,
  PredefinedPlanReadOnlyError,
  updatePlan,
} from "./plan.service.js";

function handlePlanError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof PlanAlreadyExistsError) {
    return reply.code(409).send({ error: "Plan already exists" });
  }

  if (error instanceof PlanNotAccessibleError) {
    return reply.code(404).send({ error: "Plan not found" });
  }

  if (error instanceof PredefinedPlanReadOnlyError) {
    return reply.code(403).send({ error: "Predefined plans are read-only" });
  }

  request.log.error({ err: error }, "Plan operation failed");
  return reply.code(500).send({ error: "Internal server error" });
}

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/plans",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedBody = createPlanSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      try {
        const result = await createPlan(
          request.authenticatedAccount.id,
          parsedBody.data,
        );
        return reply.code(201).send(result);
      } catch (error: unknown) {
        return handlePlanError(error, request, reply);
      }
    },
  );

  app.get(
    "/plans",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      try {
        return await listAvailablePlans(request.authenticatedAccount.id);
      } catch (error: unknown) {
        return handlePlanError(error, request, reply);
      }
    },
  );

  app.patch(
    "/plans/:planId",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedParams = updatePlanParamsSchema.safeParse(request.params);
      const parsedBody = updatePlanSchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({ error: "Invalid request" });
      }

      try {
        return await updatePlan(
          request.authenticatedAccount.id,
          parsedParams.data.planId,
          parsedBody.data,
        );
      } catch (error: unknown) {
        return handlePlanError(error, request, reply);
      }
    },
  );
};
