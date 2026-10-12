import type { FastifyPluginAsync } from "fastify";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import { createUserSchema } from "./user.schema.js";
import {
  BasicUserPlanMissingError,
  createUser,
  UserAlreadyExistsError,
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
};
