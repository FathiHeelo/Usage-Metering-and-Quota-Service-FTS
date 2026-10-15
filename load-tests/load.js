import http from "k6/http";
import { sleep } from "k6";
import { commonThresholds, durationEnv, integerEnv, numberEnv, SUMMARY_TREND_STATS } from "./config.js";
import { classifyConsume, consumeRequest, createFixture, verifyFinalUsage } from "./helpers.js";
import { createHandleSummary } from "./summary.js";

const TARGET_VUS = integerEnv("LOAD_VUS", 10);
const THINK_TIME = numberEnv("THINK_TIME_SECONDS", 0.2);
const UNITS = 1;

export const options = {
  summaryTrendStats: SUMMARY_TREND_STATS,
  scenarios: {
    normal_load: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: durationEnv("LOAD_RAMP_UP", "10s"), target: TARGET_VUS },
        { duration: durationEnv("LOAD_HOLD", "30s"), target: TARGET_VUS },
        { duration: durationEnv("LOAD_RAMP_DOWN", "10s"), target: 0 },
      ],
      gracefulRampDown: "5s",
    },
  },
  thresholds: {
    ...commonThresholds({ p95: 500, p99: 1000, technicalRate: 0 }),
    business_rejected: ["count==0"],
    final_usage_consistent: ["rate==1"],
  },
};

export function setup() {
  return createFixture("load", {
    accountMonthlyAllowance: 1_000_000_000,
    accountMaxUnitsPerRequest: 1_000,
    userMonthlyAllowance: 1_000_000_000,
    userMaxUnitsPerRequest: 1_000,
  });
}

export default function (fixture) {
  const requestId = `load_${fixture.runId}_${__VU}_${__ITER}`;
  const request = consumeRequest(fixture, requestId, UNITS);
  classifyConsume(http.post(request.url, request.body, request.params));
  sleep(THINK_TIME);
}

export function teardown(fixture) {
  verifyFinalUsage(fixture, UNITS);
}

export const handleSummary = createHandleSummary("load", TARGET_VUS);
