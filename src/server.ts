import "dotenv/config";
import { buildApp } from "./app.js";
import { loadTrustedProxyConfig } from "./config.js";

const app = buildApp({
  logger: true,
  trustProxy: loadTrustedProxyConfig(),
});
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
