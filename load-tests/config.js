export const BASE_URL = (__ENV.BASE_URL || "http://host.docker.internal:3000").replace(/\/$/, "");
export const TEST_ENVIRONMENT = __ENV.TEST_ENVIRONMENT || "local Docker Compose";
export const SUMMARY_TREND_STATS = ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"];

export function integerEnv(name, fallback, minimum = 1) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export function numberEnv(name, fallback, minimum = 0) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be a number greater than or equal to ${minimum}`);
  }
  return value;
}

export function durationEnv(name, fallback) {
  return __ENV[name] || fallback;
}

export function commonThresholds({ p95 = 500, p99 = 1000, technicalRate = 0 } = {}) {
  return {
    checks: ["rate==1"],
    technical_failure_rate: [`rate<=${technicalRate}`],
    http_req_duration: [`p(95)<${p95}`, `p(99)<${p99}`],
  };
}
