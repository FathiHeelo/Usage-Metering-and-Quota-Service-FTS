import { isIP } from "node:net";
import type { FastifyServerOptions } from "fastify";

export interface AccountCreationRateLimitConfig {
  max: number;
  timeWindowMs: number;
}

const DEFAULT_ACCOUNT_CREATION_RATE_LIMIT_MAX = 3;
const DEFAULT_ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  const configured = value ?? String(fallback);

  if (!/^[1-9]\d*$/.test(configured)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function loadAccountCreationRateLimitConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccountCreationRateLimitConfig {
  return {
    max: positiveInteger(
      environment.ACCOUNT_CREATION_RATE_LIMIT_MAX,
      DEFAULT_ACCOUNT_CREATION_RATE_LIMIT_MAX,
      "ACCOUNT_CREATION_RATE_LIMIT_MAX",
    ),
    timeWindowMs: positiveInteger(
      environment.ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS,
      DEFAULT_ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS,
      "ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS",
    ),
  };
}

function isValidIpOrCidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  const version = isIP(address ?? "");

  if (version === 0 || extra !== undefined) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  if (!/^\d+$/.test(prefix)) {
    return false;
  }

  const bits = Number(prefix);
  return (
    Number.isInteger(bits) &&
    bits >= 0 &&
    bits <= (version === 4 ? 32 : 128)
  );
}

export function loadTrustedProxyConfig(
  environment: NodeJS.ProcessEnv = process.env,
): FastifyServerOptions["trustProxy"] {
  const configured = environment.TRUSTED_PROXY_IPS?.trim();

  if (!configured) {
    return false;
  }

  const trustedProxyIps = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (
    trustedProxyIps.length === 0 ||
    trustedProxyIps.some((value) => !isValidIpOrCidr(value))
  ) {
    throw new Error(
      "TRUSTED_PROXY_IPS must be a comma-separated list of IP addresses or CIDR ranges",
    );
  }

  return trustedProxyIps;
}
