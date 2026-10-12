import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db, pool } from "./index.js";
import { plans } from "./schema.js";

const predefinedPlans = [
  {
    id: randomUUID(),
    name: "Starter",
    scope: "ACCOUNT" as const,
    monthlyAllowance: 10_000n,
    maxUnitsPerRequest: 100n,
    isPredefined: true,
    ownerAccountId: null,
  },
  {
    id: randomUUID(),
    name: "Pro",
    scope: "ACCOUNT" as const,
    monthlyAllowance: 100_000n,
    maxUnitsPerRequest: 1_000n,
    isPredefined: true,
    ownerAccountId: null,
  },
  {
    id: randomUUID(),
    name: "Basic",
    scope: "USER" as const,
    monthlyAllowance: 1_000n,
    maxUnitsPerRequest: 20n,
    isPredefined: true,
    ownerAccountId: null,
  },
  {
    id: randomUUID(),
    name: "Premium",
    scope: "USER" as const,
    monthlyAllowance: 10_000n,
    maxUnitsPerRequest: 200n,
    isPredefined: true,
    ownerAccountId: null,
  },
];

async function seed(): Promise<void> {
  await db.insert(plans).values(predefinedPlans).onConflictDoNothing();
  console.log("Predefined plans seeded successfully.");
}

seed()
  .catch((error: unknown) => {
    console.error("Failed to seed predefined plans:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
