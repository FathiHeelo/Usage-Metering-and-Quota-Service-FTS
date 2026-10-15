import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;
const configuredPoolMax = process.env.DB_POOL_MAX ?? "10";

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

if (!/^[1-9]\d*$/.test(configuredPoolMax)) {
  throw new Error("DB_POOL_MAX must be a positive integer");
}

const poolMax = Number(configuredPoolMax);

if (!Number.isSafeInteger(poolMax)) {
  throw new Error("DB_POOL_MAX must be a positive integer");
}

export const pool = new Pool({
  connectionString,
  max: poolMax,
  connectionTimeoutMillis: 5_000,
});
export const db = drizzle({ client: pool, schema });
