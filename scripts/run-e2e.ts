import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const containerName = `quota-e2e-${process.pid}-${Date.now()}`;
const databaseName = "quota_e2e_test";
const databaseUser = "quota_e2e";
const databasePassword = "quota_e2e_password";
const npmCli = process.env.npm_execpath;
const playwrightCli = resolve("node_modules", "@playwright", "test", "cli.js");
let containerStarted = false;

function run(
  command: string,
  args: string[],
  options: { capture?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stderr}\n${result.stdout}`.trim() : "";
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

function cleanup(): void {
  if (!containerStarted) return;
  spawnSync("docker", ["rm", "--force", containerName], { stdio: "ignore" });
  containerStarted = false;
}

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = spawnSync(
      "docker",
      ["exec", containerName, "pg_isready", "-U", databaseUser, "-d", databaseName],
      { stdio: "ignore" },
    );
    if (ready.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Disposable PostgreSQL did not become ready within 30 seconds");
}

process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  if (!npmCli) {
    throw new Error("npm_execpath is required; run this script through npm run test:e2e");
  }

  run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--label",
    "usage-metering.e2e=true",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,noexec,nosuid,size=256m",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    `POSTGRES_DB=${databaseName}`,
    "--env",
    `POSTGRES_USER=${databaseUser}`,
    "--env",
    `POSTGRES_PASSWORD=${databasePassword}`,
    "postgres:16",
  ]);
  containerStarted = true;
  await waitForPostgres();

  const portOutput = run(
    "docker",
    ["port", containerName, "5432/tcp"],
    { capture: true },
  );
  const portMatch = portOutput.match(/:(\d+)$/m);
  if (!portMatch) throw new Error(`Could not determine PostgreSQL port: ${portOutput}`);

  const databaseUrl = `postgresql://${databaseUser}:${databasePassword}@127.0.0.1:${portMatch[1]}/${databaseName}`;
  const testEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DB_POOL_MAX: "10",
    ACCOUNT_CREATION_RATE_LIMIT_MAX: "100",
    ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS: "60000",
  };

  run(process.execPath, [npmCli, "run", "db:migrate"], { env: testEnvironment });
  run(process.execPath, [npmCli, "run", "db:seed"], { env: testEnvironment });
  run(
    process.execPath,
    [playwrightCli, "test", "--config", "playwright.config.ts"],
    { env: testEnvironment },
  );
} finally {
  cleanup();
}
