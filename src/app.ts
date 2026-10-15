import Fastify, { type FastifyServerOptions } from "fastify";
import { accountRoutes } from "./modules/accounts/account.routes.js";
import { planRoutes } from "./modules/plans/plan.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { usageRoutes } from "./modules/usage/usage.routes.js";
import { registerApiKeyAuth } from "./plugins/api-key-auth.js";

export function buildApp(options: FastifyServerOptions = { logger: true }) {
  const app = Fastify(options);

  registerApiKeyAuth(app);
  app.get("/health", { logLevel: "warn" }, async () => ({ status: "ok" }));
  app.register(accountRoutes);
  app.register(planRoutes);
  app.register(userRoutes);
  app.register(usageRoutes);

  return app;
}
