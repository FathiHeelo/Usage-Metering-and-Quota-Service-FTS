import type { FastifyPluginAsync } from "fastify";
import type { AccountCreationRateLimitConfig } from "../../config.js";
import { authenticateApiKey } from "../../plugins/api-key-auth.js";
import {
  changeAccountPlanSchema,
  createAccountSchema,
} from "./account.schema.js";
import {
  AccountPlanNotAccessibleError,
  changeAccountPlan,
  createAccount,
  InvalidAccountPlanScopeError,
  StarterAccountPlanMissingError,
} from "./account.service.js";

interface AccountRoutesOptions {
  accountCreationRateLimit: AccountCreationRateLimitConfig;
}

export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (
  app,
  options,
) => {
  app.post(
    "/accounts",
    {
      config: {
        rateLimit: {
          max: options.accountCreationRateLimit.max,
          timeWindow: options.accountCreationRateLimit.timeWindowMs,
        },
      },
    },
    async (request, reply) => {
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
    },
  );

  app.get("/me", { preHandler: authenticateApiKey }, async (request, reply) => {
    if (!request.authenticatedAccount) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return { account: request.authenticatedAccount };
  });

  app.patch(
    "/account/plan",
    { preHandler: authenticateApiKey },
    async (request, reply) => {
      if (!request.authenticatedAccount) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const parsedBody = changeAccountPlanSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }

      try {
        const result = await changeAccountPlan(
          request.authenticatedAccount.id,
          parsedBody.data,
        );
        return reply.code(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AccountPlanNotAccessibleError) {
          return reply.code(404).send({ error: "Plan not found" });
        }

        if (error instanceof InvalidAccountPlanScopeError) {
          return reply
            .code(400)
            .send({ error: "Plan must have ACCOUNT scope" });
        }

        request.log.error({ err: error }, "Failed to change account plan");
        return reply.code(500).send({ error: "Internal server error" });
      }
    },
  );
};
