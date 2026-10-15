import http from "k6/http";
import { check } from "k6";
import { Counter, Rate } from "k6/metrics";
import { commonThresholds, SUMMARY_TREND_STATS } from "./config.js";
import {
  classifyConsume,
  classifyExpectedConflict,
  consumeRequest,
  createFixture,
  verifyFinalUsage,
} from "./helpers.js";
import { createHandleSummary } from "./summary.js";

const RETRY_COUNT = 20;
const UNITS = 7;
const idempotencyCorrectness = new Rate("idempotency_correctness");
const idempotentReplays = new Counter("idempotent_replays");

http.setResponseCallback(http.expectedStatuses(200, 409));

function decisionSignature(decision) {
  return JSON.stringify({
    accepted: decision.accepted,
    requestId: decision.requestId,
    units: decision.units,
    accountUsed: decision.account && decision.account.used,
    accountRemaining: decision.account && decision.account.remaining,
    userUsed: decision.user && decision.user.used,
    userRemaining: decision.user && decision.user.remaining,
    rejectionScope: decision.rejection && decision.rejection.scope,
    rejectionRule: decision.rejection && decision.rejection.rule,
  });
}

export const options = {
  vus: 1,
  iterations: 1,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: {
    ...commonThresholds({ p95: 1000, p99: 2000 }),
    idempotency_correctness: ["rate==1"],
    expected_conflicts: ["count==1"],
    final_usage_consistent: ["rate==1"],
  },
};

export function setup() {
  return createFixture("idempotency", {
    accountMonthlyAllowance: 10_000,
    accountMaxUnitsPerRequest: 100,
    userMonthlyAllowance: 10_000,
    userMaxUnitsPerRequest: 100,
  });
}

export default function (fixture) {
  const requestId = `idempotency_${fixture.runId}`;
  const repeated = Array.from(
    { length: RETRY_COUNT },
    () => consumeRequest(fixture, requestId, UNITS),
  );
  const decisions = http.batch(repeated).map(classifyConsume).filter(Boolean);
  const baseline = decisions[0] && decisionSignature(decisions[0]);
  const allSame =
    decisions.length === RETRY_COUNT &&
    decisions.every((decision) => decisionSignature(decision) === baseline);
  if (allSame) idempotentReplays.add(RETRY_COUNT - 1);

  const conflict = consumeRequest(fixture, requestId, UNITS + 1);
  const conflictResponse = http.post(conflict.url, conflict.body, conflict.params);
  const conflictCorrect = classifyExpectedConflict(conflictResponse);
  const correct =
    allSame &&
    decisions.every((decision) => decision.accepted === true) &&
    conflictCorrect;
  idempotencyCorrectness.add(correct);
  check(decisions, {
    "concurrent retries return one identical stored decision": () => allSame,
    "the logical request is accepted": () =>
      decisions.length === RETRY_COUNT && decisions.every((decision) => decision.accepted === true),
  });
}

export function teardown(fixture) {
  verifyFinalUsage(fixture, UNITS, UNITS);
}

export const handleSummary = createHandleSummary("idempotency", 1);
