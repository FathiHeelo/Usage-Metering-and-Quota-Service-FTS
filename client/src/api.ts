import type {
  Account,
  AccountUsage,
  AuthenticatedAccount,
  ConsumeInput,
  ConsumeResult,
  HistoryResponse,
  Plan,
  Scope,
  UserUsage,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function friendlyError(status: number, serverMessage?: string): string {
  if (status === 401) return "That API key is missing, invalid, or revoked.";
  if (status === 404) return serverMessage === "User not found"
    ? "No user with that identifier exists in this account."
    : "The requested resource was not found for this account.";
  if (status === 409) return serverMessage === "Idempotency conflict"
    ? "That request ID was already used with different details. Use the original details or create a new request ID."
    : serverMessage ?? "This record already exists.";
  if (status === 400) return "Some submitted values are invalid. Review the fields and try again.";
  if (status >= 500) return "The service could not complete the request. Check the API logs and try again.";
  return serverMessage ?? "The request could not be completed.";
}

async function request<T>(
  path: string,
  options: RequestInit & { apiKey?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (options.apiKey) headers.set("x-api-key", options.apiKey);

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError(0, "The API is unavailable. Confirm Docker is running and try again.");
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    const serverMessage =
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : undefined;
    throw new ApiError(response.status, friendlyError(response.status, serverMessage));
  }

  return body as T;
}

export const api = {
  createAccount(name: string) {
    return request<{ account: Account & { plan: { id: string; name: string } }; apiKey: string }>(
      "/accounts",
      { method: "POST", body: JSON.stringify({ name }) },
    );
  },
  getMe(apiKey: string) {
    return request<{ account: AuthenticatedAccount }>("/me", { apiKey });
  },
  getPlans(apiKey: string) {
    return request<{ plans: Plan[] }>("/plans", { apiKey });
  },
  createPlan(
    apiKey: string,
    input: { name: string; scope: Scope; monthlyAllowance: number; maxUnitsPerRequest: number },
  ) {
    return request<{ plan: Plan }>("/plans", {
      apiKey,
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updatePlan(
    apiKey: string,
    planId: string,
    input: { name?: string; monthlyAllowance?: number; maxUnitsPerRequest?: number },
  ) {
    return request<{ plan: Plan }>(`/plans/${encodeURIComponent(planId)}`, {
      apiKey,
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  changeAccountPlan(apiKey: string, planId: string) {
    return request<{ account: Account & { plan: { id: string; name: string } } }>(
      "/account/plan",
      { apiKey, method: "PATCH", body: JSON.stringify({ planId }) },
    );
  },
  createUser(apiKey: string, externalUserId: string) {
    return request<{ user: { id: string; externalUserId: string; plan: { id: string; name: string } } }>(
      "/users",
      { apiKey, method: "POST", body: JSON.stringify({ externalUserId }) },
    );
  },
  changeUserPlan(apiKey: string, externalUserId: string, planId: string) {
    return request<{ user: { id: string; externalUserId: string; plan: { id: string; name: string } } }>(
      `/users/${encodeURIComponent(externalUserId)}/plan`,
      { apiKey, method: "PATCH", body: JSON.stringify({ planId }) },
    );
  },
  getAccountUsage(apiKey: string, month?: string) {
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    return request<AccountUsage>(`/usage/account${query}`, { apiKey });
  },
  getUserUsage(apiKey: string, externalUserId: string, month?: string) {
    const query = month ? `?month=${encodeURIComponent(month)}` : "";
    return request<UserUsage>(
      `/usage/users/${encodeURIComponent(externalUserId)}${query}`,
      { apiKey },
    );
  },
  getHistory(
    apiKey: string,
    filters: { page?: number; limit?: number; externalUserId?: string; status?: string; month?: string },
  ) {
    const search = new URLSearchParams();
    if (filters.page) search.set("page", String(filters.page));
    if (filters.limit) search.set("limit", String(filters.limit));
    if (filters.externalUserId) search.set("externalUserId", filters.externalUserId);
    if (filters.status) search.set("status", filters.status);
    if (filters.month) search.set("month", filters.month);
    return request<HistoryResponse>(`/usage/history?${search.toString()}`, { apiKey });
  },
  consume(apiKey: string, input: ConsumeInput) {
    return request<ConsumeResult>("/usage/consume", {
      apiKey,
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
