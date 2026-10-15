import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleGauge,
  Clipboard,
  Copy,
  Database,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  type FormEvent,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, ApiError } from "./api";
import type {
  Account,
  AccountUsage,
  ConsumeInput,
  ConsumeResult,
  HistoryItem,
  HistoryResponse,
  KnownUser,
  Plan,
  PlanSummary,
  Scope,
  UserUsage,
  UsageStatus,
} from "./types";

type Page = "dashboard" | "users" | "plans" | "playground" | "history";

interface Session {
  apiKey: string;
  account: Account;
  accountPlan?: PlanSummary;
}

interface ToastState {
  tone: "success" | "error" | "info";
  message: string;
}

const SESSION_KEY = "quota-console-session";

function readSession(): Session | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as Session) : null;
  } catch {
    return null;
  }
}

function readKnownUsers(accountId: string): KnownUser[] {
  try {
    const value = sessionStorage.getItem(`quota-console-users:${accountId}`);
    return value ? (JSON.parse(value) as KnownUser[]) : [];
  } catch {
    return [];
  }
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUnits(value: string | number): string {
  return new Intl.NumberFormat("en-US").format(toNumber(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function humanMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function inferPlan(
  plans: Plan[],
  scope: Scope,
  monthlyLimit?: string,
  preferredId?: string,
): Plan | undefined {
  if (preferredId) {
    const preferred = plans.find((plan) => plan.id === preferredId && plan.scope === scope);
    if (preferred) return preferred;
  }
  if (!monthlyLimit) return undefined;
  const matches = plans.filter(
    (plan) => plan.scope === scope && plan.monthlyAllowance === monthlyLimit,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function newRequestId(): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `demo_${Date.now()}_${suffix}`;
}

export function App() {
  const [session, setSessionState] = useState<Session | null>(() => readSession());
  const [page, setPage] = useState<Page>("dashboard");
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>(() =>
    session ? readKnownUsers(session.account.id) : [],
  );
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  function setSession(next: Session | null) {
    setSessionState(next);
    if (next) sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(SESSION_KEY);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function updateKnownUser(user: KnownUser) {
    if (!session) return;
    setKnownUsers((current) => {
      const next = [
        user,
        ...current.filter((item) => item.externalUserId !== user.externalUserId),
      ];
      sessionStorage.setItem(
        `quota-console-users:${session.account.id}`,
        JSON.stringify(next),
      );
      return next;
    });
  }

  function updateAccountPlan(plan: PlanSummary) {
    if (!session) return;
    setSession({ ...session, accountPlan: plan });
    setRefreshVersion((value) => value + 1);
  }

  async function establishSession(apiKey: string, preferredPlan?: PlanSummary) {
    const { account } = await api.getMe(apiKey);
    let accountPlan = preferredPlan;
    try {
      const [{ plans }, usage] = await Promise.all([
        api.getPlans(apiKey),
        api.getAccountUsage(apiKey),
      ]);
      const inferred = inferPlan(plans, "ACCOUNT", usage.monthlyLimit, preferredPlan?.id);
      if (inferred) accountPlan = { id: inferred.id, name: inferred.name };
    } catch {
      // Authentication succeeded; individual dashboard panels provide retry UI.
    }
    const next = { apiKey, account, accountPlan };
    setSession(next);
    setKnownUsers(readKnownUsers(account.id));
  }

  function disconnect() {
    setSession(null);
    setKnownUsers([]);
    setPage("dashboard");
    setToast({ tone: "info", message: "Disconnected. The API key was removed from this browser session." });
  }

  if (!session) {
    return (
      <>
        <Onboarding
          onConnect={async (apiKey) => {
            await establishSession(apiKey);
            setToast({ tone: "success", message: "Connected to your account." });
          }}
          onCreated={async (apiKey, plan) => {
            setIssuedKey(apiKey);
            await establishSession(apiKey, plan);
          }}
        />
        {issuedKey && <ApiKeyModal apiKey={issuedKey} onClose={() => setIssuedKey(null)} />}
        {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </>
    );
  }

  return (
    <>
      <AppShell
        page={page}
        setPage={setPage}
        account={session.account}
        onDisconnect={disconnect}
      >
        {page === "dashboard" && (
          <DashboardPage
            apiKey={session.apiKey}
            account={session.account}
            accountPlan={session.accountPlan}
            refreshVersion={refreshVersion}
            onNavigate={setPage}
          />
        )}
        {page === "users" && (
          <UsersPage
            apiKey={session.apiKey}
            knownUsers={knownUsers}
            onKnownUser={updateKnownUser}
            notify={setToast}
          />
        )}
        {page === "plans" && (
          <PlansPage
            apiKey={session.apiKey}
            accountPlan={session.accountPlan}
            knownUsers={knownUsers}
            onAccountPlanChanged={updateAccountPlan}
            onKnownUser={updateKnownUser}
            notify={setToast}
          />
        )}
        {page === "playground" && (
          <PlaygroundPage
            apiKey={session.apiKey}
            accountPlan={session.accountPlan}
            knownUsers={knownUsers}
            notify={setToast}
            onUsageChanged={() => setRefreshVersion((value) => value + 1)}
          />
        )}
        {page === "history" && <HistoryPage apiKey={session.apiKey} />}
      </AppShell>
      {issuedKey && <ApiKeyModal apiKey={issuedKey} onClose={() => setIssuedKey(null)} />}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  );
}

function Onboarding({
  onConnect,
  onCreated,
}: {
  onConnect: (apiKey: string) => Promise<void>;
  onCreated: (apiKey: string, plan: PlanSummary) => Promise<void>;
}) {
  const [mode, setMode] = useState<"create" | "connect">("create");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "create") {
        if (!name.trim()) throw new Error("Enter a name for the demo account.");
        const result = await api.createAccount(name.trim());
        await onCreated(result.apiKey, result.account.plan);
      } else {
        if (!apiKey.trim()) throw new Error("Paste an API key to connect.");
        await onConnect(apiKey.trim());
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="onboarding">
      <section className="onboarding-story">
        <div className="brand brand-light">
          <span className="brand-mark"><Gauge size={22} /></span>
          <span>Quota Console</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow eyebrow-light"><Sparkles size={14} /> Interactive API demo</span>
          <h1>Usage limits that stay correct under pressure.</h1>
          <p>
            Explore account and user quotas, plan changes, idempotent requests, and
            decision history through the real metering API.
          </p>
          <div className="story-points">
            <div><ShieldCheck /><span><strong>Tenant-safe</strong>Every request is scoped by the API key.</span></div>
            <div><Zap /><span><strong>Concurrency-ready</strong>Atomic decisions protect monthly allowances.</span></div>
            <div><History /><span><strong>Auditable</strong>Accepted and rejected attempts keep snapshots.</span></div>
          </div>
        </div>
        <div className="story-footnote">
          <LockKeyhole size={16} /> Local demonstration environment · API keys stay in this browser session
        </div>
      </section>
      <section className="onboarding-panel">
        <div className="onboarding-card">
          <div className="mobile-brand brand">
            <span className="brand-mark"><Gauge size={22} /></span><span>Quota Console</span>
          </div>
          <span className="eyebrow">Get started</span>
          <h2>{mode === "create" ? "Create a demo account" : "Connect an account"}</h2>
          <p className="lede">
            {mode === "create"
              ? "Start on the predefined Starter account plan and receive an API key for this demo."
              : "Use an API key previously returned by the account creation endpoint."}
          </p>
          <div className="segmented" role="tablist" aria-label="Connection method">
            <button className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(null); }} type="button">New account</button>
            <button className={mode === "connect" ? "active" : ""} onClick={() => { setMode("connect"); setError(null); }} type="button">Existing key</button>
          </div>
          <form onSubmit={submit} className="stack-lg">
            {mode === "create" ? (
              <Field label="Account name" helper="A recognizable organization or application name, such as Northstar Docs.">
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Northstar Docs" autoFocus />
              </Field>
            ) : (
              <Field label="API key" helper="Sent only in the X-API-Key header. It is never placed in a URL or console log.">
                <div className="input-with-icon"><KeyRound size={18} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="uq_live_••••••••••••" autoComplete="off" autoFocus /></div>
              </Field>
            )}
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
            <button className="button button-primary button-wide" disabled={loading}>
              {loading ? <><Spinner /> Connecting…</> : <>{mode === "create" ? "Create account" : "Connect securely"}<ArrowRight size={18} /></>}
            </button>
          </form>
          <div className="demo-note">
            <BookOpen size={18} />
            <p><strong>Built for evaluation.</strong> This convenient API-key entry flow is intentionally local and is not presented as production identity management.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function ApiKeyModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
  }
  return (
    <Modal title="Save your API key" onClose={onClose} size="medium">
      <div className="key-hero"><KeyRound size={26} /><div><strong>This key is shown only once</strong><span>It authenticates requests for your new account.</span></div></div>
      <div className="secret-box"><code>{apiKey}</code><button className="icon-button" onClick={copy} aria-label="Copy API key">{copied ? <Check size={18} /> : <Copy size={18} />}</button></div>
      <InlineMessage tone="warning">Do not share production API keys. The backend stores only a cryptographic hash, so this raw value cannot be recovered later.</InlineMessage>
      <button className="button button-primary button-wide" onClick={onClose}>I saved the key</button>
    </Modal>
  );
}

function AppShell({
  page,
  setPage,
  account,
  onDisconnect,
  children,
}: {
  page: Page;
  setPage: (page: Page) => void;
  account: Account;
  onDisconnect: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "plans", label: "Plans", icon: WalletCards },
    { id: "playground", label: "Usage playground", icon: Zap },
    { id: "history", label: "Request history", icon: History },
  ];
  const go = (target: Page) => { setPage(target); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <div className="brand brand-light"><span className="brand-mark"><Gauge size={21} /></span><span>Quota Console</span></div>
          <button className="sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <nav aria-label="Primary navigation">
          <span className="nav-label">Workspace</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => go(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-guide">
          <div className="guide-icon"><BookOpen size={18} /></div>
          <strong>How quotas work</strong>
          <p>Both account and user limits must pass before units are recorded.</p>
          <button onClick={() => go("playground")}>Try a request <ArrowRight size={14} /></button>
        </div>
        <div className="sidebar-account">
          <div className="avatar">{account.name.slice(0, 2).toUpperCase()}</div>
          <div><strong>{account.name}</strong><span>Connected account</span></div>
          <button onClick={onDisconnect} aria-label="Disconnect API key" title="Disconnect"><LogOut size={17} /></button>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <div className="app-main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="topbar-context"><span className="status-dot" /><div><small>Active account</small><strong>{account.name}</strong></div></div>
          <div className="topbar-actions"><span className="api-status"><Server size={15} /> API connected</span><button className="button button-ghost" onClick={onDisconnect}><LogOut size={17} /><span>Disconnect</span></button></div>
        </header>
        <div className="page-wrap">{children}</div>
      </div>
    </div>
  );
}

function DashboardPage({
  apiKey,
  account,
  accountPlan,
  refreshVersion,
  onNavigate,
}: {
  apiKey: string;
  account: Account;
  accountPlan?: PlanSummary;
  refreshVersion: number;
  onNavigate: (page: Page) => void;
}) {
  const [usage, setUsage] = useState<AccountUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [usageResult, planResult, historyResult] = await Promise.all([
        api.getAccountUsage(apiKey),
        api.getPlans(apiKey),
        api.getHistory(apiKey, { page: 1, limit: 5 }),
      ]);
      setUsage(usageResult); setPlans(planResult.plans); setHistory(historyResult.items);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [apiKey, refreshVersion]);

  const plan = usage ? inferPlan(plans, "ACCOUNT", usage.monthlyLimit, accountPlan?.id) : undefined;
  const percent = usage && toNumber(usage.monthlyLimit) > 0
    ? Math.min(100, (toNumber(usage.used) / toNumber(usage.monthlyLimit)) * 100)
    : 0;
  const health = percent >= 100 ? ["Quota exhausted", "danger"] : percent >= 80 ? ["Approaching quota", "warning"] : ["Healthy usage", "success"];

  if (loading && !usage) return <PageLoader label="Loading your quota overview…" />;
  return (
    <>
      <PageHeader eyebrow="Workspace overview" title={`Good to see you, ${account.name}`} description="Monitor this month's account quota and the latest decisions made by the metering service." actions={<button className="button button-primary" onClick={() => onNavigate("playground")}><Zap size={17} /> Consume units</button>} />
      {error && <InlineMessage tone="error" action={<button onClick={load}>Retry</button>}>{error}</InlineMessage>}
      {usage && (
        <>
          <section className="metric-grid">
            <MetricCard icon={<CircleGauge />} label="Monthly allowance" value={formatUnits(usage.monthlyLimit)} hint="Maximum account units this UTC month" accent="blue" />
            <MetricCard icon={<Activity />} label="Used units" value={formatUnits(usage.used)} hint={`${percent.toFixed(1)}% of the account allowance`} accent="violet" />
            <MetricCard icon={<Sparkles />} label="Remaining units" value={formatUnits(usage.remaining)} hint="Available before account-level rejection" accent="green" />
            <MetricCard icon={<Zap />} label="Max per request" value={plan ? formatUnits(plan.maxUnitsPerRequest) : "—"} hint={plan ? `Applied by ${plan.name}` : "Unavailable when plan limits are ambiguous"} accent="amber" />
          </section>
          <section className="dashboard-grid">
            <div className="card quota-card">
              <div className="card-heading"><div><span className="eyebrow">Account quota</span><h2>{humanMonth(usage.month)}</h2></div><StatusBadge tone={health[1] as "success" | "warning" | "danger"}>{health[0]}</StatusBadge></div>
              <div className="quota-visual">
                <div className="usage-ring" style={{ "--progress": `${percent * 3.6}deg` } as CSSProperties}><div><strong>{Math.round(percent)}%</strong><span>used</span></div></div>
                <div className="quota-breakdown">
                  <div><span>Current plan</span><strong>{plan?.name ?? accountPlan?.name ?? "Active account plan"}</strong></div>
                  <div><span>Consumed</span><strong>{formatUnits(usage.used)} units</strong></div>
                  <div><span>Still available</span><strong>{formatUnits(usage.remaining)} units</strong></div>
                </div>
              </div>
              <div className="progress-track" aria-label={`${percent.toFixed(1)} percent used`}><span style={{ width: `${percent}%` }} /></div>
              <p className="card-note"><CalendarDays size={16} /> Quotas reset by UTC calendar month. Changing plans changes future limits but never erases recorded usage.</p>
            </div>
            <div className="card explain-card">
              <div className="explain-icon"><Database /></div>
              <span className="eyebrow">Two-level protection</span>
              <h2>Every request checks two budgets.</h2>
              <p>An accepted request must fit both the organization's account plan and the individual user's plan.</p>
              <div className="rule-flow"><span>Account quota</span><ArrowRight /><span>User quota</span><ArrowRight /><strong>Decision</strong></div>
              <button className="text-button" onClick={() => onNavigate("plans")}>Explore plan rules <ArrowRight size={15} /></button>
            </div>
          </section>
        </>
      )}
      <section className="card table-card">
        <div className="card-heading"><div><span className="eyebrow">Latest decisions</span><h2>Recent consumption activity</h2><p>Rejected attempts are recorded for auditability but do not increase usage.</p></div><button className="button button-secondary" onClick={() => onNavigate("history")}>View history <ArrowRight size={16} /></button></div>
        {history.length ? <HistoryTable items={history} compact /> : <EmptyState icon={<History />} title="No usage requests yet" description="Create a user, then use the playground to submit the first real quota decision." action={<button className="button button-primary" onClick={() => onNavigate("playground")}>Open playground</button>} />}
      </section>
    </>
  );
}

function UsersPage({ apiKey, knownUsers, onKnownUser, notify }: { apiKey: string; knownUsers: KnownUser[]; onKnownUser: (user: KnownUser) => void; notify: (toast: ToastState) => void }) {
  const [newId, setNewId] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [selectedId, setSelectedId] = useState(knownUsers[0]?.externalUserId ?? "");
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPlans(apiKey).then((result) => setPlans(result.plans)).catch((cause) => setError(errorMessage(cause)));
  }, [apiKey]);

  useEffect(() => {
    if (!selectedId) { setUsage(null); return; }
    setBusy("usage"); setError(null);
    api.getUserUsage(apiKey, selectedId)
      .then((result) => {
        setUsage(result);
        const known = knownUsers.find((user) => user.externalUserId === selectedId);
        const plan = inferPlan(plans, "USER", result.monthlyLimit, known?.plan?.id);
        onKnownUser({ ...known, externalUserId: selectedId, plan: plan ? { id: plan.id, name: plan.name } : known?.plan });
        if (plan) setSelectedPlanId(plan.id);
      })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setBusy(null));
  }, [apiKey, selectedId, plans.length]);

  async function createUser(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (!newId.trim()) { setError("Enter the identifier your product uses for this user."); return; }
    setBusy("create");
    try {
      const { user } = await api.createUser(apiKey, newId.trim());
      onKnownUser({ id: user.id, externalUserId: user.externalUserId, plan: user.plan });
      setSelectedId(user.externalUserId); setNewId("");
      notify({ tone: "success", message: `${user.externalUserId} was created on the ${user.plan.name} plan.` });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  async function lookup(event: FormEvent) {
    event.preventDefault();
    if (!lookupId.trim()) { setError("Enter a user identifier to look up."); return; }
    setSelectedId(lookupId.trim()); setLookupId("");
  }

  async function changePlan() {
    if (!selectedId || !selectedPlanId) return;
    setBusy("plan"); setError(null);
    try {
      const { user } = await api.changeUserPlan(apiKey, selectedId, selectedPlanId);
      onKnownUser({ id: user.id, externalUserId: user.externalUserId, plan: user.plan });
      const updatedUsage = await api.getUserUsage(apiKey, selectedId);
      setUsage(updatedUsage);
      notify({ tone: "success", message: `${selectedId} now uses the ${user.plan.name} plan. Existing usage was preserved.` });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  const selectedKnown = knownUsers.find((user) => user.externalUserId === selectedId);
  const userPlans = plans.filter((plan) => plan.scope === "USER");
  const percent = usage && toNumber(usage.monthlyLimit) > 0 ? Math.min(100, toNumber(usage.used) / toNumber(usage.monthlyLimit) * 100) : 0;

  return (
    <>
      <PageHeader eyebrow="User management" title="Users and individual quotas" description="Register product users under this account, inspect their monthly usage, and assign an accessible USER plan." />
      <InfoBanner icon={<ShieldCheck />} title="Account ownership is automatic">The API key determines the account. User forms never accept an account ID, so one tenant cannot create or inspect another tenant's users.</InfoBanner>
      {error && <InlineMessage tone="error" action={<button onClick={() => setError(null)}>Dismiss</button>}>{error}</InlineMessage>}
      <section className="split-grid">
        <form className="card form-card" onSubmit={createUser}>
          <div className="card-heading"><div className="heading-icon blue"><Plus /></div><div><h2>Create a user</h2><p>New users start on the predefined Basic USER plan.</p></div></div>
          <Field label="External user identifier" helper="The stable ID your application already uses, such as user_001. It must be unique inside this account."><input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder="user_001" /></Field>
          <button className="button button-primary" disabled={busy === "create"}>{busy === "create" ? <><Spinner /> Creating…</> : <><Plus size={17} /> Create user</>}</button>
        </form>
        <form className="card form-card" onSubmit={lookup}>
          <div className="card-heading"><div className="heading-icon violet"><Search /></div><div><h2>Find a user</h2><p>Look up current usage with an exact external identifier.</p></div></div>
          <Field label="External user identifier" helper="The service intentionally does not expose cross-account search or a global user directory."><input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="user_001" /></Field>
          <button className="button button-secondary"><Search size={17} /> View usage</button>
        </form>
      </section>
      <section className="card table-card">
        <div className="card-heading"><div><span className="eyebrow">Browser workspace</span><h2>Recently used identifiers</h2><p>These shortcuts come only from users created or looked up in this browser session; usage is always fetched live.</p></div></div>
        {knownUsers.length ? <div className="user-chips">{knownUsers.map((user) => <button key={user.externalUserId} className={selectedId === user.externalUserId ? "user-chip active" : "user-chip"} onClick={() => setSelectedId(user.externalUserId)}><span className="avatar avatar-small">{user.externalUserId.slice(0, 2).toUpperCase()}</span><span><strong>{user.externalUserId}</strong><small>{user.plan?.name ?? "Plan resolved from live usage"}</small></span><ChevronRight size={16} /></button>)}</div> : <EmptyState icon={<Users />} title="No users in this session" description="Create a user or look one up by its external identifier." />}
      </section>
      {selectedId && (
        <section className="card user-detail-card">
          <div className="card-heading"><div><span className="eyebrow">User detail</span><h2>{selectedId}</h2><p>Monthly user quota for {usage ? humanMonth(usage.month) : "the current UTC month"}.</p></div><StatusBadge tone={percent >= 100 ? "danger" : percent >= 80 ? "warning" : "success"}>{percent >= 100 ? "Exhausted" : percent >= 80 ? "Approaching limit" : "Healthy"}</StatusBadge></div>
          {busy === "usage" ? <PageLoader label="Loading user usage…" compact /> : usage && <div className="user-detail-grid"><div className="quota-summary"><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="summary-numbers"><div><span>Used</span><strong>{formatUnits(usage.used)}</strong></div><div><span>Remaining</span><strong>{formatUnits(usage.remaining)}</strong></div><div><span>Monthly limit</span><strong>{formatUnits(usage.monthlyLimit)}</strong></div></div></div><div className="plan-control"><Field label="Current user plan" helper="Changing the plan affects future decisions. Previously consumed units remain recorded."><select value={selectedPlanId || selectedKnown?.plan?.id || ""} onChange={(event) => setSelectedPlanId(event.target.value)}><option value="">Choose a USER plan</option>{userPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatUnits(plan.monthlyAllowance)}/month</option>)}</select></Field><button className="button button-primary" onClick={changePlan} disabled={!selectedPlanId || busy === "plan"}>{busy === "plan" ? <><Spinner /> Updating…</> : "Apply plan"}</button></div></div>}
        </section>
      )}
      <InfoBanner icon={<CircleGauge />} title="Account quota vs. user quota">Account quota caps total organization usage. User quota caps one individual. A request is accepted only when both have enough allowance and both per-request limits permit it.</InfoBanner>
    </>
  );
}

function PlansPage({ apiKey, accountPlan, knownUsers, onAccountPlanChanged, onKnownUser, notify }: { apiKey: string; accountPlan?: PlanSummary; knownUsers: KnownUser[]; onAccountPlanChanged: (plan: PlanSummary) => void; onKnownUser: (user: KnownUser) => void; notify: (toast: ToastState) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [accountPlanId, setAccountPlanId] = useState(accountPlan?.id ?? "");
  const [assignUserId, setAssignUserId] = useState(knownUsers[0]?.externalUserId ?? "");
  const [assignPlanId, setAssignPlanId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setPlans((await api.getPlans(apiKey)).plans); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [apiKey]);

  async function changeAccountPlan() {
    if (!accountPlanId) return;
    setBusy("account"); setError(null);
    try {
      const { account } = await api.changeAccountPlan(apiKey, accountPlanId);
      onAccountPlanChanged(account.plan);
      notify({ tone: "success", message: `Account plan changed to ${account.plan.name}. Existing monthly usage was preserved.` });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  async function assignUserPlan(event: FormEvent) {
    event.preventDefault();
    if (!assignUserId.trim() || !assignPlanId) { setError("Enter a user identifier and select a USER plan."); return; }
    setBusy("user"); setError(null);
    try {
      const { user } = await api.changeUserPlan(apiKey, assignUserId.trim(), assignPlanId);
      onKnownUser({ id: user.id, externalUserId: user.externalUserId, plan: user.plan });
      notify({ tone: "success", message: `${user.externalUserId} now uses ${user.plan.name}.` });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(null); }
  }

  const accountPlans = plans.filter((plan) => plan.scope === "ACCOUNT");
  const userPlans = plans.filter((plan) => plan.scope === "USER");
  return (
    <>
      <PageHeader eyebrow="Plan management" title="Limits for every level" description="Compare predefined global plans with custom plans owned only by this account." actions={<button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> New custom plan</button>} />
      <InfoBanner icon={<Sparkles />} title="Plan changes preserve usage">Changing a plan changes the limits applied to future requests. Previously recorded usage is not erased or reset.</InfoBanner>
      {error && <InlineMessage tone="error" action={<button onClick={() => setError(null)}>Dismiss</button>}>{error}</InlineMessage>}
      <section className="assignment-grid">
        <div className="card form-card compact-form">
          <div className="card-heading"><div><span className="eyebrow">Organization limit</span><h2>Change account plan</h2><p>ACCOUNT plans cap all usage across the organization.</p></div></div>
          <Field label="Available ACCOUNT plan" helper="Global predefined plans and custom plans owned by this account are assignable."><select value={accountPlanId} onChange={(event) => setAccountPlanId(event.target.value)}><option value="">Choose an account plan</option>{accountPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatUnits(plan.monthlyAllowance)}/month</option>)}</select></Field>
          <button className="button button-primary" onClick={changeAccountPlan} disabled={!accountPlanId || busy === "account"}>{busy === "account" ? <><Spinner /> Applying…</> : "Apply account plan"}</button>
        </div>
        <form className="card form-card compact-form" onSubmit={assignUserPlan}>
          <div className="card-heading"><div><span className="eyebrow">Individual limit</span><h2>Assign a user plan</h2><p>USER plans control one external user without changing the account cap.</p></div></div>
          <div className="inline-fields"><Field label="User identifier" helper="Exact external ID under this account."><input list="known-user-list" value={assignUserId} onChange={(event) => setAssignUserId(event.target.value)} placeholder="user_001" /><datalist id="known-user-list">{knownUsers.map((user) => <option key={user.externalUserId} value={user.externalUserId} />)}</datalist></Field><Field label="USER plan" helper="Only USER-scoped plans can be assigned."><select value={assignPlanId} onChange={(event) => setAssignPlanId(event.target.value)}><option value="">Choose a plan</option>{userPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></Field></div>
          <button className="button button-secondary" disabled={busy === "user"}>{busy === "user" ? <><Spinner /> Assigning…</> : "Assign user plan"}</button>
        </form>
      </section>
      <section className="section-heading"><div><span className="eyebrow">Plan catalog</span><h2>Available plans</h2><p>Predefined plans are shared and read-only. Custom plans are private to this account and editable.</p></div><span className="count-pill">{plans.length} plans</span></section>
      {loading ? <PageLoader label="Loading plan catalog…" /> : <div className="plan-grid">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} current={plan.id === accountPlan?.id} onEdit={() => setEditing(plan)} />)}</div>}
      {createOpen && <PlanFormModal title="Create a custom plan" submitLabel="Create plan" onClose={() => setCreateOpen(false)} onSubmit={async (input) => { await api.createPlan(apiKey, input); setCreateOpen(false); await load(); notify({ tone: "success", message: `${input.name} was created and is available to this account.` }); }} />}
      {editing && !editing.isPredefined && <PlanFormModal title={`Edit ${editing.name}`} submitLabel="Save changes" initial={editing} lockScope onClose={() => setEditing(null)} onSubmit={async (input) => { await api.updatePlan(apiKey, editing.id, { name: input.name, monthlyAllowance: input.monthlyAllowance, maxUnitsPerRequest: input.maxUnitsPerRequest }); setEditing(null); await load(); notify({ tone: "success", message: "Custom plan updated. New limits apply to future quota decisions." }); }} />}
    </>
  );
}

function PlanCard({ plan, current, onEdit }: { plan: Plan; current: boolean; onEdit: () => void }) {
  return <article className={`plan-card ${current ? "current" : ""}`}><div className="plan-card-top"><span className={`scope-icon ${plan.scope.toLowerCase()}`}>{plan.scope === "ACCOUNT" ? <Database /> : <Users />}</span><div className="badge-row"><span className={`badge ${plan.scope === "ACCOUNT" ? "badge-blue" : "badge-violet"}`}>{plan.scope}</span><span className="badge badge-neutral">{plan.isPredefined ? "Predefined" : "Custom"}</span>{current && <span className="badge badge-green">Current</span>}</div></div><h3>{plan.name}</h3><p>{plan.scope === "ACCOUNT" ? "Shared organization quota" : "Individual user quota"}</p><div className="plan-limits"><div><span>Monthly allowance</span><strong>{formatUnits(plan.monthlyAllowance)}</strong></div><div><span>Max per request</span><strong>{formatUnits(plan.maxUnitsPerRequest)}</strong></div></div>{plan.isPredefined ? <div className="readonly-note"><LockKeyhole size={14} /> Global, read-only plan</div> : <button className="button button-secondary button-wide" onClick={onEdit}><Pencil size={15} /> Edit custom plan</button>}</article>;
}

function PlanFormModal({ title, submitLabel, initial, lockScope = false, onClose, onSubmit }: { title: string; submitLabel: string; initial?: Plan; lockScope?: boolean; onClose: () => void; onSubmit: (input: { name: string; scope: Scope; monthlyAllowance: number; maxUnitsPerRequest: number }) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [scope, setScope] = useState<Scope>(initial?.scope ?? "USER");
  const [monthly, setMonthly] = useState(initial?.monthlyAllowance ?? "5000");
  const [maxRequest, setMaxRequest] = useState(initial?.maxUnitsPerRequest ?? "100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    const monthlyValue = Number(monthly); const requestValue = Number(maxRequest);
    if (!name.trim()) { setError("Plan name cannot be empty."); return; }
    if (!Number.isSafeInteger(monthlyValue) || monthlyValue < 0 || !Number.isSafeInteger(requestValue) || requestValue < 0) { setError("Limits must be non-negative whole numbers."); return; }
    setLoading(true);
    try { await onSubmit({ name: name.trim(), scope, monthlyAllowance: monthlyValue, maxUnitsPerRequest: requestValue }); }
    catch (cause) { setError(errorMessage(cause)); setLoading(false); }
  }
  return <Modal title={title} onClose={onClose}><form onSubmit={submit} className="stack-lg"><Field label="Plan name" helper="Unique inside this account and scope. Use a name your team will recognize."><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Growth" autoFocus /></Field><Field label="Plan scope" helper="ACCOUNT limits the whole organization. USER limits one individual."><select value={scope} onChange={(event) => setScope(event.target.value as Scope)} disabled={lockScope}><option value="USER">USER — individual allowance</option><option value="ACCOUNT">ACCOUNT — organization allowance</option></select></Field><div className="inline-fields"><Field label="Monthly allowance" helper="Maximum units available during one UTC calendar month."><input type="number" min="0" step="1" value={monthly} onChange={(event) => setMonthly(event.target.value)} /></Field><Field label="Maximum units per request" helper="Largest single consumption request that can be accepted."><input type="number" min="0" step="1" value={maxRequest} onChange={(event) => setMaxRequest(event.target.value)} /></Field></div>{error && <InlineMessage tone="error">{error}</InlineMessage>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? <><Spinner /> Saving…</> : submitLabel}</button></div></form></Modal>;
}

function PlaygroundPage({ apiKey, accountPlan, knownUsers, notify, onUsageChanged }: { apiKey: string; accountPlan?: PlanSummary; knownUsers: KnownUser[]; notify: (toast: ToastState) => void; onUsageChanged: () => void }) {
  const [userId, setUserId] = useState(knownUsers[0]?.externalUserId ?? "");
  const [units, setUnits] = useState("10");
  const [requestId, setRequestId] = useState(newRequestId);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [accountUsage, setAccountUsage] = useState<AccountUsage | null>(null);
  const [userUsage, setUserUsage] = useState<UserUsage | null>(null);
  const [result, setResult] = useState<ConsumeResult | null>(null);
  const [lastSubmission, setLastSubmission] = useState<ConsumeInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadContext(targetUser = userId) {
    try {
      const [planResult, accountResult] = await Promise.all([api.getPlans(apiKey), api.getAccountUsage(apiKey)]);
      setPlans(planResult.plans); setAccountUsage(accountResult);
      if (targetUser.trim()) setUserUsage(await api.getUserUsage(apiKey, targetUser.trim()));
      else setUserUsage(null);
    } catch (cause) {
      if (targetUser.trim()) setError(errorMessage(cause));
    }
  }
  useEffect(() => { void loadContext(); }, [apiKey]);

  async function submit(input?: ConsumeInput) {
    setError(null); setResult(null);
    const requested = input ?? { userId: userId.trim(), units: Number(units), requestId: requestId.trim() };
    if (!requested.userId) { setError("Choose or enter a user identifier."); return; }
    if (!Number.isSafeInteger(requested.units) || requested.units <= 0) { setError("Units must be a positive whole number."); return; }
    if (!requested.requestId) { setError("Create a unique request ID before submitting."); return; }
    setLoading(true);
    try {
      const decision = await api.consume(apiKey, requested);
      setResult(decision); setLastSubmission(requested);
      setUserId(requested.userId); setUnits(String(requested.units)); setRequestId(requested.requestId);
      await loadContext(requested.userId); onUsageChanged();
      notify({ tone: decision.accepted ? "success" : "info", message: decision.accepted ? `${decision.units} units were recorded.` : "The request was rejected and no usage was added." });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  const known = knownUsers.find((user) => user.externalUserId === userId);
  const activeAccountPlan = accountUsage ? inferPlan(plans, "ACCOUNT", accountUsage.monthlyLimit, accountPlan?.id) : undefined;
  const activeUserPlan = userUsage ? inferPlan(plans, "USER", userUsage.monthlyLimit, known?.plan?.id) : undefined;
  const requestLimit = Math.min(
    activeAccountPlan ? toNumber(activeAccountPlan.maxUnitsPerRequest) : Number.MAX_SAFE_INTEGER,
    activeUserPlan ? toNumber(activeUserPlan.maxUnitsPerRequest) : Number.MAX_SAFE_INTEGER,
  );
  const remainingLimit = Math.min(
    accountUsage ? toNumber(accountUsage.remaining) : Number.MAX_SAFE_INTEGER,
    userUsage ? toNumber(userUsage.remaining) : Number.MAX_SAFE_INTEGER,
  );
  const monthlyPreset = Number.isFinite(requestLimit) && remainingLimit + 1 <= requestLimit ? remainingLimit + 1 : null;

  function applyPreset(kind: "valid" | "request" | "monthly") {
    setResult(null); setError(null); setRequestId(newRequestId());
    if (kind === "valid") {
      const valid = Math.min(10, requestLimit, remainingLimit);
      if (!Number.isFinite(valid) || valid < 1) { setError("No units are currently available for a valid request."); return; }
      setUnits(String(valid));
    } else if (kind === "request") {
      if (!Number.isFinite(requestLimit)) { setError("Look up a user first so the real request limits are available."); return; }
      setUnits(String(requestLimit + 1));
    } else {
      if (monthlyPreset === null) { setError("A one-request monthly-limit example is not possible with the current remaining allowance and per-request limits."); return; }
      setUnits(String(monthlyPreset));
    }
  }

  return (
    <>
      <PageHeader eyebrow="Interactive API" title="Usage playground" description="Send real consumption requests and see exactly how account limits, user limits, and idempotency shape the decision." />
      <section className="playground-layout">
        <div className="card playground-form">
          <div className="card-heading"><div><span className="eyebrow">POST /usage/consume</span><h2>Simulate product usage</h2><p>Nothing is consumed until you explicitly submit this form.</p></div><span className="live-pill"><span /> Live API</span></div>
          <div className="preset-row"><span>Helpful presets</span><button onClick={() => applyPreset("valid")} type="button"><CheckCircle2 size={15} /> Valid consumption</button><button onClick={() => applyPreset("request")} type="button"><AlertTriangle size={15} /> Exceed per-request</button><button onClick={() => applyPreset("monthly")} type="button"><CircleGauge size={15} /> Exceed monthly</button></div>
          <div className="stack-lg">
            <Field label="User identifier" helper="The external ID of a user owned by this account. Both that user's quota and the account quota will be checked."><input list="playground-users" value={userId} onChange={(event) => { setUserId(event.target.value); setUserUsage(null); }} onBlur={() => { if (userId.trim()) void loadContext(userId); }} placeholder="user_001" /><datalist id="playground-users">{knownUsers.map((user) => <option key={user.externalUserId} value={user.externalUserId} />)}</datalist></Field>
            <Field label="Number of units" helper="A positive whole number representing the metered work for this request."><input type="number" min="1" step="1" value={units} onChange={(event) => setUnits(event.target.value)} /></Field>
            <Field label="Unique request ID" helper="An idempotency key. Retrying the same ID with the same user and units returns the original decision without charging twice."><div className="input-action"><input value={requestId} onChange={(event) => setRequestId(event.target.value)} /><button type="button" onClick={() => setRequestId(newRequestId())} title="Generate a new request ID"><RefreshCw size={17} /></button></div></Field>
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
            <button className="button button-primary button-large button-wide" onClick={() => void submit()} disabled={loading}>{loading ? <><Spinner /> Evaluating quotas…</> : <><Zap size={19} /> Consume units</>}</button>
            {lastSubmission && <button className="button button-secondary button-wide" onClick={() => void submit(lastSubmission)} disabled={loading}><RefreshCw size={17} /> Retry same request</button>}
          </div>
        </div>
        <div className="playground-side">
          <div className="card context-card"><span className="eyebrow">Live quota context</span><h2>Limits used by the API</h2><div className="context-list"><div><span>Account remaining</span><strong>{accountUsage ? formatUnits(accountUsage.remaining) : "—"}</strong><small>{activeAccountPlan?.name ?? "Current account plan"}</small></div><div><span>User remaining</span><strong>{userUsage ? formatUnits(userUsage.remaining) : "—"}</strong><small>{activeUserPlan?.name ?? (userId ? "Look up user to resolve" : "Choose a user")}</small></div><div><span>Effective request ceiling</span><strong>{Number.isFinite(requestLimit) ? formatUnits(requestLimit) : "—"}</strong><small>The lower of account and user caps</small></div></div><button className="text-button" onClick={() => void loadContext()}><RefreshCw size={14} /> Refresh live limits</button></div>
          {result ? <DecisionCard result={result} onRetry={() => lastSubmission && void submit(lastSubmission)} /> : <div className="card decision-placeholder"><div className="placeholder-orbit"><Zap /></div><h2>Your decision will appear here</h2><p>The response will clearly show accepted or rejected status, the reason, and account/user counters after the decision.</p></div>}
        </div>
      </section>
    </>
  );
}

function DecisionCard({ result, onRetry }: { result: ConsumeResult; onRetry: () => void }) {
  const rejectionText = result.rejection
    ? result.rejection.rule === "MAX_UNITS_PER_REQUEST"
      ? `The request exceeded the ${result.rejection.scope?.toLowerCase()} plan's maximum units per request.`
      : `The request would exceed the ${result.rejection.scope?.toLowerCase()} plan's monthly allowance.`
    : "";
  return <div className={`card decision-card ${result.accepted ? "accepted" : "rejected"}`}><div className="decision-status">{result.accepted ? <CheckCircle2 /> : <AlertTriangle />}<div><span>{result.accepted ? "ACCEPTED" : "REJECTED"}</span><h2>{result.accepted ? `${formatUnits(result.units)} units recorded` : "No usage was consumed"}</h2></div></div><p>{result.accepted ? "Both the account and user had enough monthly allowance, and the request fit their per-request limits." : rejectionText}</p><div className="decision-counters"><div><span>Account after</span><strong>{formatUnits(result.account.used)} used</strong><small>{formatUnits(result.account.remaining)} remaining</small></div><div><span>User after</span><strong>{formatUnits(result.user.used)} used</strong><small>{formatUnits(result.user.remaining)} remaining</small></div></div><div className="request-reference"><span>Request ID</span><code>{result.requestId}</code></div><button className="button button-secondary button-wide" onClick={onRetry}><RefreshCw size={16} /> Retry exact request</button><p className="microcopy">The retry reuses the exact request ID, user, and units. The API returns this stored decision without consuming again.</p></div>;
}

function HistoryPage({ apiKey }: { apiKey: string }) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | UsageStatus>("");
  const [externalUserId, setExternalUserId] = useState("");
  const [month, setMonth] = useState("");
  const [applied, setApplied] = useState({ status: "", externalUserId: "", month: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 10;
  async function load() {
    setLoading(true); setError(null);
    try { setHistory(await api.getHistory(apiKey, { page, limit, status: applied.status, externalUserId: applied.externalUserId, month: applied.month })); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [apiKey, page, applied]);
  const pages = history ? Math.max(1, Math.ceil(history.total / history.limit)) : 1;
  function filter(event: FormEvent) { event.preventDefault(); setPage(1); setApplied({ status, externalUserId: externalUserId.trim(), month }); }
  function clear() { setStatus(""); setExternalUserId(""); setMonth(""); setPage(1); setApplied({ status: "", externalUserId: "", month: "" }); }
  return (
    <>
      <PageHeader eyebrow="Audit trail" title="Usage request history" description="Inspect stored decisions and their immutable usage snapshots. Rejected attempts remain visible because they explain why no units were charged." />
      <form className="card filter-bar" onSubmit={filter}><Field label="User identifier" compact><input value={externalUserId} onChange={(event) => setExternalUserId(event.target.value)} placeholder="All users" /></Field><Field label="Decision status" compact><select value={status} onChange={(event) => setStatus(event.target.value as "" | UsageStatus)}><option value="">All statuses</option><option value="ACCEPTED">Accepted</option><option value="REJECTED">Rejected</option></select></Field><Field label="UTC month" compact><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field><div className="filter-actions"><button className="button button-primary"><Search size={16} /> Apply filters</button><button type="button" className="button button-ghost" onClick={clear}>Clear</button></div></form>
      {error && <InlineMessage tone="error" action={<button onClick={load}>Retry</button>}>{error}</InlineMessage>}
      <section className="card table-card">
        <div className="card-heading"><div><span className="eyebrow">Decision log</span><h2>{history ? `${history.total} request${history.total === 1 ? "" : "s"}` : "Requests"}</h2><p>Snapshots show counters immediately after each decision, even if plans change later.</p></div></div>
        {loading ? <PageLoader label="Loading request history…" compact /> : history?.items.length ? <><HistoryTable items={history.items} /><div className="pagination"><span>Page {page} of {pages}</span><div><button className="icon-button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft /></button><button className="icon-button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight /></button></div></div></> : <EmptyState icon={<History />} title="No matching requests" description="Adjust the filters or use the playground to submit a consumption request." />}
      </section>
      <InfoBanner icon={<Clipboard />} title="Why rejected requests are kept">A rejection records the limits and counters that produced the decision. Neither the account counter nor user counter increases when status is REJECTED.</InfoBanner>
    </>
  );
}

function HistoryTable({ items, compact = false }: { items: HistoryItem[]; compact?: boolean }) {
  return <div className="responsive-table"><table><thead><tr><th>Status</th><th>Request</th><th>User</th><th>Units</th><th>Decision details</th>{!compact && <th>Counter snapshots</th>}<th>Time</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.requestId}-${item.createdAt}`}><td><StatusBadge tone={item.status === "ACCEPTED" ? "success" : "danger"}>{item.status}</StatusBadge></td><td><code className="table-code">{item.requestId}</code></td><td><strong>{item.externalUserId}</strong></td><td>{formatUnits(item.units)}</td><td>{item.rejection ? <span className="rejection-copy">{item.rejection.scope} · {item.rejection.rule === "MAX_UNITS_PER_REQUEST" ? "Per-request limit" : "Monthly allowance"}</span> : <span className="muted">Usage recorded</span>}</td>{!compact && <td><span className="snapshot-copy">Account {formatUnits(item.account.usedAfter)} used<br />User {formatUnits(item.user.usedAfter)} used</span></td>}<td><span className="muted nowrap">{formatDate(item.createdAt)}</span></td></tr>)}</tbody></table></div>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

function Field({ label, helper, compact = false, children }: { label: string; helper?: string; compact?: boolean; children: ReactNode }) {
  return <label className={`field ${compact ? "field-compact" : ""}`}><span>{label}</span>{children}{helper && <small>{helper}</small>}</label>;
}

function MetricCard({ icon, label, value, hint, accent }: { icon: ReactNode; label: string; value: string; hint: string; accent: string }) {
  return <article className="metric-card"><div className={`metric-icon ${accent}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{hint}</small></div></article>;
}

function StatusBadge({ tone, children }: { tone: "success" | "warning" | "danger"; children: ReactNode }) {
  return <span className={`status-badge ${tone}`}><span />{children}</span>;
}

function InlineMessage({ tone, action, children }: { tone: "error" | "warning" | "info"; action?: ReactNode; children: ReactNode }) {
  return <div className={`inline-message ${tone}`}>{tone === "error" || tone === "warning" ? <AlertTriangle size={18} /> : <BookOpen size={18} />}<span>{children}</span>{action}</div>;
}

function InfoBanner({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <aside className="info-banner"><div>{icon}</div><p><strong>{title}</strong><span>{children}</span></p></aside>;
}

function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div>{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function PageLoader({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`page-loader ${compact ? "compact" : ""}`}><Spinner /><span>{label}</span></div>;
}

function Spinner() { return <span className="spinner" aria-hidden="true" />; }

function Modal({ title, onClose, size = "large", children }: { title: string; onClose: () => void; size?: "medium" | "large"; children: ReactNode }) {
  useEffect(() => {
    function close(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X /></button></header><div className="modal-body">{children}</div></section></div>;
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  return <div className={`toast ${toast.tone}`} role="status">{toast.tone === "success" ? <CheckCircle2 /> : toast.tone === "error" ? <AlertTriangle /> : <BookOpen />}<span>{toast.message}</span><button onClick={onClose} aria-label="Dismiss message"><X /></button></div>;
}
