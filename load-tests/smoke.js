import http from "k6/http";
import { commonThresholds, SUMMARY_TREND_STATS } from "./config.js";
import { classifyConsume, consumeRequest, createFixture, verifyFinalUsage } from "./helpers.js";
import { createHandleSummary } from "./summary.js";

const ITERATIONS = 5;
const UNITS = 2;

export const options = {
  vus: 1,
  iterations: ITERATIONS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: {
    ...commonThresholds({ p95: 500, p99: 1000 }),
    business_rejected: ["count==0"],
    final_usage_consistent: ["rate==1"],
  },
};

export function setup() {
  return createFixture("smoke", {
    accountMonthlyAllowance: 10_000,
    accountMaxUnitsPerRequest: 100,
    userMonthlyAllowance: 10_000,
    userMaxUnitsPerRequest: 100,
  });
}

export default function (fixture) {
  const requestId = `smoke_${fixture.runId}_${__VU}_${__ITER}`;
  const request = consumeRequest(fixture, requestId, UNITS);
  classifyConsume(http.post(request.url, request.body, request.params));
}

export function teardown(fixture) {
  verifyFinalUsage(fixture, UNITS, ITERATIONS * UNITS);
}

export const handleSummary = createHandleSummary("smoke", 1);
