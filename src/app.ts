import { existsSync } from "node:fs";
import { resolve } from "node:path";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  type AccountCreationRateLimitConfig,
  loadAccountCreationRateLimitConfig,
} from "./config.js";
import { accountRoutes } from "./modules/accounts/account.routes.js";
import { planRoutes } from "./modules/plans/plan.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { usageRoutes } from "./modules/usage/usage.routes.js";
import { registerApiKeyAuth } from "./plugins/api-key-auth.js";
import { openApiPlugin } from "./plugins/openapi.js";

type BuildAppOptions = FastifyServerOptions & {
  accountCreationRateLimit?: AccountCreationRateLimitConfig;
};

function accountCreationRateLimitError() {
  const error = new Error(
    "Too many account creation requests. Please try again later.",
  ) as Error & { statusCode: number };
  error.statusCode = 429;
  return error;
}

export function buildApp(options: BuildAppOptions = { logger: true }) {
  const {
    accountCreationRateLimit = loadAccountCreationRateLimitConfig(),
    ...fastifyOptions
  } = options;
  const app = Fastify(fastifyOptions);

  registerApiKeyAuth(app);
  app.register(openApiPlugin);
  app.register(rateLimit, {
    global: false,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    errorResponseBuilder: accountCreationRateLimitError,
  });
  app.get("/health", { logLevel: "warn" }, async () => ({ status: "ok" }));
  app.register(accountRoutes, { accountCreationRateLimit });
  app.register(planRoutes);
  app.register(userRoutes);
  app.register(usageRoutes);

  const clientRoot = resolve(process.cwd(), "dist", "public");
  if (existsSync(clientRoot)) {
    app.register(fastifyStatic, {
      root: clientRoot,
      wildcard: false,
    });
  }

  return app;
}
