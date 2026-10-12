import Fastify, { type FastifyServerOptions } from "fastify";
import { accountRoutes } from "./modules/accounts/account.routes.js";

export function buildApp(options: FastifyServerOptions = { logger: true }) {
  const app = Fastify(options);

  app.get("/health", async () => ({ status: "ok" }));
  app.register(accountRoutes);

  return app;
}
