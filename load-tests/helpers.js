import http from "k6/http";
import { check } from "k6";
import { Counter, Gauge, Rate } from "k6/metrics";
import { BASE_URL } from "./config.js";

export const acceptedDecisions = new Counter("business_accepted");
export const rejectedDecisions = new Counter("business_rejected");
export const technicalFailures = new Counter("technical_failures");
export const technicalFailureRate = new Rate("technical_failure_rate");
export const expectedConflicts = new Counter("expected_conflicts");
export const finalAccountUsage = new Gauge("final_account_usage");
export const finalUserUsage = new Gauge("final_user_usage");
export const expectedFinalUsage = new Gauge("expected_final_usage");
export const finalUsageConsistent = new Rate("final_usage_consistent");

function json(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function authParams(apiKey, name) {
  return {
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    tags: { name },
  };
}

function setupRequest(method, path, apiKey, body, label) {
  const params = apiKey
    ? authParams(apiKey, `setup:${label}`)
    : { headers: { "Content-Type": "application/json" }, tags: { name: `setup:${label}` } };
  const response = http.request(method, `${BASE_URL}${path}`, body ? JSON.stringify(body) : null, params);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  const parsed = json(response);
  if (!parsed) throw new Error(`${label} returned invalid JSON`);
  return parsed;
}

export function uniqueRunId(testName) {
  const supplied = __ENV.RUN_ID;
  const suffix = supplied || `${Date.now()}_${Math.floor(Math.random() * 1_000_000_000)}`;
  return `${testName}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function createFixture(
  testName,
  {
    accountMonthlyAllowance,
    accountMaxUnitsPerRequest,
    userMonthlyAllowance,
    userMaxUnitsPerRequest,
  },
) {
  const runId = uniqueRunId(testName);
  const accountResult = setupRequest(
    "POST",
    "/accounts",
    null,
    { name: `k6 ${testName} ${runId}` },
    "create account",
  );
  const apiKey = accountResult.apiKey;
  const accountId = accountResult.account && accountResult.account.id;
  if (typeof apiKey !== "string" || typeof accountId !== "string") {
    throw new Error("create account returned an unexpected response shape");
  }

  const externalUserId = `k6_user_${runId}`;
  const userResult = setupRequest(
    "POST",
    "/users",
    apiKey,
    { externalUserId },
    "create user",
  );
  if (!userResult.user || userResult.user.externalUserId !== externalUserId) {
    throw new Error("create user returned an unexpected response shape");
  }

  const accountPlan = setupRequest(
    "POST",
    "/plans",
    apiKey,
    {
      name: `k6_account_${runId}`,
      scope: "ACCOUNT",
      monthlyAllowance: accountMonthlyAllowance,
      maxUnitsPerRequest: accountMaxUnitsPerRequest,
    },
    "create account plan",
  );
  const userPlan = setupRequest(
    "POST",
    "/plans",
    apiKey,
    {
      name: `k6_user_${runId}`,
      scope: "USER",
      monthlyAllowance: userMonthlyAllowance,
      maxUnitsPerRequest: userMaxUnitsPerRequest,
    },
    "create user plan",
  );
  if (!accountPlan.plan || !accountPlan.plan.id || !userPlan.plan || !userPlan.plan.id) {
    throw new Error("custom plan setup returned an unexpected response shape");
  }

  setupRequest(
    "PATCH",
    "/account/plan",
    apiKey,
    { planId: accountPlan.plan.id },
    "assign account plan",
  );
  setupRequest(
    "PATCH",
    `/users/${encodeURIComponent(externalUserId)}/plan`,
    apiKey,
    { planId: userPlan.plan.id },
    "assign user plan",
  );

  return { runId, accountId, apiKey, externalUserId };
}

export function consumeRequest(fixture, requestId, units) {
  return {
    method: "POST",
    url: `${BASE_URL}/usage/consume`,
    body: JSON.stringify({
      userId: fixture.externalUserId,
      units,
      requestId,
    }),
    params: authParams(fixture.apiKey, "POST /usage/consume"),
  };
}

export function classifyConsume(response) {
  const body = json(response);
  const validDecision = response.status === 200 && body && typeof body.accepted === "boolean";
  const technicalFailure = !validDecision;
  technicalFailureRate.add(technicalFailure);
  if (technicalFailure) technicalFailures.add(1);
  acceptedDecisions.add(validDecision && body.accepted ? 1 : 0);
  rejectedDecisions.add(validDecision && !body.accepted ? 1 : 0);

  check(response, {
    "consume returns HTTP 200": (result) => result.status === 200,
    "consume returns an accepted/rejected decision": () => validDecision,
  });
  return validDecision ? body : null;
}

export function classifyExpectedConflict(response) {
  const body = json(response);
  const isExpected = response.status === 409 && body && body.error === "Idempotency conflict";
  technicalFailureRate.add(!isExpected);
  if (isExpected) expectedConflicts.add(1);
  else technicalFailures.add(1);
  check(response, {
    "conflicting idempotency reuse returns HTTP 409": (result) => result.status === 409,
    "conflict follows the API contract": () => isExpected,
  });
  return isExpected;
}

export function verifyFinalUsage(fixture, unitSize, exactExpected) {
  const params = authParams(fixture.apiKey, "verify usage");
  const [accountResponse, userResponse, historyResponse] = http.batch([
    ["GET", `${BASE_URL}/usage/account`, null, params],
    ["GET", `${BASE_URL}/usage/users/${encodeURIComponent(fixture.externalUserId)}`, null, params],
    ["GET", `${BASE_URL}/usage/history?page=1&limit=1&status=ACCEPTED`, null, params],
  ]);
  const accountBody = json(accountResponse);
  const userBody = json(userResponse);
  const historyBody = json(historyResponse);
  const readsOk = [accountResponse, userResponse, historyResponse].every((response) => response.status === 200);
  const accountUsed = Number(accountBody && accountBody.used);
  const userUsed = Number(userBody && userBody.used);
  const acceptedTotal = Number(historyBody && historyBody.total);
  const expected = exactExpected === undefined ? acceptedTotal * unitSize : exactExpected;
  const consistent =
    readsOk &&
    Number.isSafeInteger(accountUsed) &&
    Number.isSafeInteger(userUsed) &&
    Number.isSafeInteger(expected) &&
    accountUsed === expected &&
    userUsed === expected;

  finalAccountUsage.add(Number.isFinite(accountUsed) ? accountUsed : -1);
  finalUserUsage.add(Number.isFinite(userUsed) ? userUsed : -1);
  expectedFinalUsage.add(Number.isFinite(expected) ? expected : -1);
  finalUsageConsistent.add(consistent);
  technicalFailureRate.add(!readsOk);
  if (!readsOk) technicalFailures.add(1);
  check(accountResponse, {
    "final account and user usage match expected accepted consumption": () => consistent,
  });

  return { accountUsed, userUsed, acceptedTotal, expected, consistent };
}
