import { resolve } from "node:path";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyPluginAsync } from "fastify";

export const openApiPlugin: FastifyPluginAsync = async (app) => {
  const specificationDirectory = resolve(process.cwd(), "openapi");

  await app.register(swagger, {
    mode: "static",
    specification: {
      path: resolve(specificationDirectory, "openapi.json"),
      baseDir: specificationDirectory,
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    staticCSP: true,
    uiConfig: {
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: "list",
      persistAuthorization: false,
      tryItOutEnabled: true,
    },
    theme: {
      title: "Quota Service API Documentation",
      css: [
        {
          filename: "quota-service.css",
          content:
            ".swagger-ui .topbar{background:#082f67}.swagger-ui .info .title{color:#0b3978}.swagger-ui .btn.authorize{color:#0b63ce;border-color:#0b63ce}.swagger-ui .btn.authorize svg{fill:#0b63ce}",
        },
      ],
    },
  });
};
