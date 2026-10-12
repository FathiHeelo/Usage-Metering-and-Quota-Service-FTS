export {};

interface NodeProcess {
  env?: { API_KEY?: string };
  exit(code?: number): never;
  exitCode?: number;
}

const detectedProcess = (globalThis as typeof globalThis & {
  process?: NodeProcess;
}).process;

if (!detectedProcess) {
  throw new Error("This script must be run with Node.js.");
}

const runtimeProcess: NodeProcess = detectedProcess;

const baseUrl = "http://127.0.0.1:3000";
const configuredApiKey = runtimeProcess.env?.API_KEY;

if (!configuredApiKey) {
  console.error("API_KEY environment variable is required.");
  runtimeProcess.exit(1);
}

const apiKey: string = configuredApiKey;

class SetupRequestError extends Error {}

interface PlanResponse {
  plan?: { id?: string };
}

interface UserResponse {
  user?: { id?: string; externalUserId?: string };
}

interface ConsumeResponse {
  accepted?: boolean;
}

async function setupRequest(
  label: string,
  path: string,
  method: "POST" | "PATCH",
  payload: unknown,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();

  if (!response.ok) {
    console.error(`${label} failed: HTTP ${response.status}`);
    console.error(responseText || "<empty response body>");
    throw new SetupRequestError();
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    console.error(`${label} returned invalid JSON: HTTP ${response.status}`);
    console.error(responseText || "<empty response body>");
    throw new SetupRequestError();
  }
}

async function main(): Promise<void> {
  const runId = Date.now();
  const externalUserId = `user_concurrency_${runId}`;

  const planBody = (await setupRequest(
    "Create concurrency plan",
    "/plans",
    "POST",
    {
      name: `ConcurrencyTest_${runId}`,
      scope: "USER",
      monthlyAllowance: 50,
      maxUnitsPerRequest: 10,
    },
  )) as PlanResponse;
  const planId = planBody.plan?.id;

  if (!planId) {
    console.error("Create concurrency plan returned an unexpected body:");
    console.error(JSON.stringify(planBody));
    throw new SetupRequestError();
  }

  const userBody = (await setupRequest(
    "Create concurrency user",
    "/users",
    "POST",
    { externalUserId },
  )) as UserResponse;

  if (!userBody.user?.id || userBody.user.externalUserId !== externalUserId) {
    console.error("Create concurrency user returned an unexpected body:");
    console.error(JSON.stringify(userBody));
    throw new SetupRequestError();
  }

  await setupRequest(
    "Assign concurrency plan",
    `/users/${encodeURIComponent(externalUserId)}/plan`,
    "PATCH",
    { planId },
  );

  const requestIds = Array.from(
    { length: 10 },
    (_, index) =>
      `concurrency_${runId}_${String(index + 1).padStart(3, "0")}`,
  );

  // Calling fetch while mapping starts every request before Promise.all awaits them.
  const consumeRequests = requestIds.map((requestId) =>
    fetch(`${baseUrl}/usage/consume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        userId: externalUserId,
        units: 10,
        requestId,
      }),
    }).then(async (response) => {
      const responseText = await response.text();
      let body: ConsumeResponse = {};

      try {
        body = JSON.parse(responseText) as ConsumeResponse;
      } catch {
        // The raw body is retained below for diagnostics.
      }

      return {
        requestId,
        status: response.status,
        accepted: body.accepted,
        responseBody: responseText,
      };
    }),
  );

  const results = await Promise.all(consumeRequests);

  for (const result of results) {
    const decision =
      result.accepted === true
        ? "ACCEPTED"
        : result.accepted === false
          ? "REJECTED"
          : "UNEXPECTED RESPONSE";

    console.log(`${result.requestId}: HTTP ${result.status} - ${decision}`);

    if (result.accepted === undefined || result.status !== 200) {
      console.log(`  Response body: ${result.responseBody || "<empty>"}`);
    }
  }

  const acceptedCount = results.filter(
    (result) => result.accepted === true,
  ).length;
  const rejectedCount = results.filter(
    (result) => result.accepted === false,
  ).length;

  console.log("\nSummary");
  console.log(`Accepted: ${acceptedCount}`);
  console.log(`Rejected: ${rejectedCount}`);

  if (acceptedCount !== 5 || rejectedCount !== 5) {
    console.error("CONCURRENCY TEST FAILED");
    runtimeProcess.exitCode = 1;
    return;
  }

  console.log("CONCURRENCY TEST PASSED");
}

main().catch((error: unknown) => {
  if (!(error instanceof SetupRequestError)) {
    console.error("Concurrency check failed unexpectedly:", error);
  }
  runtimeProcess.exitCode = 1;
});
