import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied successfully.");
}

runMigrations()
  .catch((error: unknown) => {
    console.error("Failed to apply database migrations:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
