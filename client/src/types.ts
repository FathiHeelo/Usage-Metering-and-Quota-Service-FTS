export type Scope = "ACCOUNT" | "USER";
export type UsageStatus = "ACCEPTED" | "REJECTED";
export type RejectionRule = "MONTHLY_ALLOWANCE" | "MAX_UNITS_PER_REQUEST";

export interface Account {
  id: string;
  name: string;
}

export interface Plan {
  id: string;
  name: string;
  scope: Scope;
  monthlyAllowance: string;
  maxUnitsPerRequest: string;
  isPredefined: boolean;
}

export interface PlanSummary {
  id: string;
  name: string;
}

export interface KnownUser {
  id?: string;
  externalUserId: string;
  plan?: PlanSummary;
}

export interface AccountUsage {
  accountId: string;
  month: string;
  used: string;
  monthlyLimit: string;
  remaining: string;
}

export interface UserUsage {
  externalUserId: string;
  month: string;
  used: string;
  monthlyLimit: string;
  remaining: string;
}

export interface UsageSnapshot {
  usedAfter: string;
  remainingAfter: string;
}

export interface HistoryItem {
  requestId: string;
  externalUserId: string;
  units: string;
  status: UsageStatus;
  rejection: { scope: Scope | null; rule: RejectionRule | null } | null;
  createdAt: string;
  account: UsageSnapshot;
  user: UsageSnapshot;
}

export interface HistoryResponse {
  items: HistoryItem[];
  page: number;
  limit: number;
  total: number;
}

export interface ConsumeResult {
  accepted: boolean;
  requestId: string;
  units: string;
  account: { used: string; remaining: string };
  user: { used: string; remaining: string };
  rejection?: { scope: Scope | null; rule: RejectionRule | null };
}

export interface ConsumeInput {
  userId: string;
  units: number;
  requestId: string;
}
