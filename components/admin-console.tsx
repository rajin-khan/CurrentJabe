"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CurrentJabeWordmark } from "@/components/brand-mark";
import { ArrowIcon, CheckIcon, CloseIcon, SearchIcon } from "@/components/icons";

type AdminTab = "overview" | "reports" | "areas" | "system" | "audit";
type JsonRecord = Record<string, unknown>;

type SessionState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "signed-in"; username: string };

type AdminReport = JsonRecord & {
  id: string;
  entityType: "daily_submission" | "outage_event" | "status_confirmation";
  created_at: string;
  upazila_id?: string;
  suppressed_at?: string | null;
  visitorFingerprint?: string;
};

type AdminArea = JsonRecord & {
  id: string;
  name_en: string;
  name_bn?: string | null;
  district_id: string;
  disabled: boolean;
  disable_reason?: string | null;
};

type AdminSettings = {
  submissions_enabled: boolean;
  site_kill_switch: boolean;
  public_message?: string | null;
  updated_at?: string;
  updated_by?: string;
};

type AuditEntry = JsonRecord & {
  id: string | number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason?: string | null;
  created_at: string;
};

class AdminApiError extends Error {
  code: string;
  constructor(message: string, code = "admin_request_failed") {
    super(message);
    this.code = code;
  }
}

function adminErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } }
    | null;
  if (!response.ok || !payload || !payload.ok) {
    const error = payload && !payload.ok ? payload.error : null;
    throw new AdminApiError(error?.message ?? "Admin request failed.", error?.code);
  }
  return payload.data;
}

export function AdminConsole() {
  const [session, setSession] = useState<SessionState>({ status: "checking" });
  const [tab, setTab] = useState<AdminTab>("overview");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [areas, setAreas] = useState<AdminArea[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConsole = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      adminRequest<{ reports: AdminReport[] }>("/api/admin/reports?limit=100"),
      adminRequest<{ areas: AdminArea[] }>("/api/admin/areas?limit=1000"),
      adminRequest<{ settings: AdminSettings | null }>("/api/admin/settings"),
      adminRequest<{ entries: AuditEntry[] }>("/api/admin/audit?limit=100"),
    ]);
    if (results[0].status === "fulfilled") setReports(results[0].value.reports);
    if (results[1].status === "fulfilled") setAreas(results[1].value.areas);
    if (results[2].status === "fulfilled") setSettings(results[2].value.settings);
    if (results[3].status === "fulfilled") setAudit(results[3].value.entries);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "Some CMS data could not load.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    adminRequest<{ authenticated: true; username: string }>("/api/admin/auth/session")
      .then((data) => {
        setSession({ status: "signed-in", username: data.username });
        void loadConsole();
      })
      .catch(() => setSession({ status: "signed-out" }));
  }, [loadConsole]);

  if (session.status === "checking") {
    return <div className="admin-loading">Checking the circuit…</div>;
  }

  if (session.status === "signed-out") {
    return <AdminLogin onSuccess={(username) => {
      setSession({ status: "signed-in", username });
      void loadConsole();
    }} />;
  }

  const signOut = async () => {
    await adminRequest("/api/admin/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    setSession({ status: "signed-out" });
  };

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <CurrentJabeWordmark />
        <div className="admin-sidebar__label">Signal room</div>
        <nav aria-label="CMS sections">
          {(["overview", "reports", "areas", "system", "audit"] as const).map((item, index) => (
            <button className={tab === item ? "is-active" : ""} key={item} type="button" onClick={() => setTab(item)}>
              <span>{String(index + 1).padStart(2, "0")}</span>{item}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar__user">
          <span>{session.username}</span>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <section className="admin-workspace">
        <header className="admin-topbar">
          <div>
            <p>PRIVATE OPERATOR CMS</p>
            <h1>{tab}</h1>
          </div>
          <div className="admin-topbar__status">
            <span className={settings?.site_kill_switch ? "is-danger" : ""} />
            {settings?.site_kill_switch ? "Site halted" : "System available"}
          </div>
          <button type="button" onClick={loadConsole} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {error ? <div className="admin-error" role="alert">{error}</div> : null}
        {tab === "overview" ? <AdminOverview reports={reports} areas={areas} settings={settings} audit={audit} /> : null}
        {tab === "reports" ? <AdminReports reports={reports} onRefresh={loadConsole} /> : null}
        {tab === "areas" ? <AdminAreas areas={areas} onRefresh={loadConsole} /> : null}
        {tab === "system" ? <AdminSystem settings={settings} onRefresh={loadConsole} /> : null}
        {tab === "audit" ? <AdminAudit entries={audit} /> : null}
      </section>
    </main>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await adminRequest("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onSuccess(username);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sign-in failed.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="admin-login">
      <div className="admin-login__brand"><CurrentJabeWordmark /></div>
      <form onSubmit={submit}>
        <p>SIGNAL ROOM · PRIVATE ACCESS</p>
        <h1>Operate quietly.</h1>
        <label>
          <span>Username</span>
          <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          <span>Password</span>
          <input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <div className="admin-error" role="alert">{error}</div> : null}
        <button type="submit" disabled={working}>
          {working ? "Checking…" : "Enter signal room"}<ArrowIcon />
        </button>
        <small>The hidden path and noindex header are not the security boundary. Your signed, expiring session is.</small>
      </form>
    </main>
  );
}

function AdminOverview({ reports, areas, settings, audit }: { reports: AdminReport[]; areas: AdminArea[]; settings: AdminSettings | null; audit: AuditEntry[] }) {
  const suppressed = reports.filter((report) => Boolean(report.suppressed_at)).length;
  const disabled = areas.filter((area) => area.disabled).length;
  return (
    <div className="admin-overview">
      <div className="admin-metrics">
        <article><span>Visible sample</span><strong>{reports.length - suppressed}</strong><small>recent report records</small></article>
        <article><span>Suppressed</span><strong>{suppressed}</strong><small>in current result set</small></article>
        <article><span>Areas loaded</span><strong>{areas.length}</strong><small>{disabled} disabled</small></article>
        <article><span>Submissions</span><strong>{settings?.submissions_enabled ? "ON" : "OFF"}</strong><small>global intake</small></article>
      </div>
      <div className="admin-section-head"><h2>Recent operator activity</h2><span>{audit.length} loaded</span></div>
      <AdminAudit entries={audit.slice(0, 8)} compact />
    </div>
  );
}

function AdminReports({ reports, onRefresh }: { reports: AdminReport[]; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AdminReport | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => JSON.stringify(report).toLowerCase().includes(needle));
  }, [query, reports]);

  const changeSuppression = async () => {
    if (!target) return;
    setWorking(true);
    setError(null);
    try {
      await adminRequest(`/api/admin/reports/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          entityType: target.entityType,
          suppressed: !target.suppressed_at,
          reason: target.suppressed_at ? "" : reason,
        }),
      });
      setTarget(null);
      setReason("");
      await onRefresh();
    } catch (requestError) {
      setError(adminErrorMessage(requestError, "The report action could not be saved."));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="admin-panel">
      {!target && error ? <div className="admin-error" role="alert">{error}</div> : null}
      <div className="admin-filter"><SearchIcon /><input placeholder="Search loaded reports" value={query} onChange={(event) => setQuery(event.target.value)} /><span>{filtered.length}</span></div>
      <div className="admin-table admin-table--reports">
        <div className="admin-table__head"><span>Type</span><span>Area</span><span>Created</span><span>Visitor</span><span>Status</span><span /></div>
        {filtered.map((report) => (
          <div className="admin-table__row" key={`${report.entityType}-${report.id}`}>
            <span data-label="Type">{report.entityType.replaceAll("_", " ")}</span>
            <span data-label="Area">{String(report.upazila_id ?? "—")}</span>
            <span data-label="Created">{new Date(report.created_at).toLocaleString()}</span>
            <span data-label="Visitor">{report.visitorFingerprint ?? "—"}</span>
            <span data-label="Status" className={report.suppressed_at ? "admin-badge admin-badge--off" : "admin-badge"}>{report.suppressed_at ? "Suppressed" : "Visible"}</span>
            <button type="button" onClick={() => {
              setError(null);
              setTarget(report);
            }}>{report.suppressed_at ? "Restore" : "Suppress"}</button>
          </div>
        ))}
      </div>
      {target ? (
        <div className="admin-action-overlay" role="presentation" onMouseDown={() => {
          if (!working) setTarget(null);
        }}>
          <div className="admin-action-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <button className="dialog-close" disabled={working} type="button" aria-label="Close report action" onClick={() => setTarget(null)}><CloseIcon /></button>
            <p>{target.entityType}</p>
            <h2>{target.suppressed_at ? "Restore this report?" : "Suppress this report?"}</h2>
            {target.suppressed_at ? null : <textarea required placeholder="Reason for the audit log" value={reason} onChange={(event) => setReason(event.target.value)} />}
            {error ? <div className="admin-action-error" role="alert">{error}</div> : null}
            <button className="button-primary" disabled={working || (!target.suppressed_at && !reason.trim())} type="button" onClick={changeSuppression}>{working ? "Saving…" : "Confirm action"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminAreas({ areas, onRefresh }: { areas: AdminArea[]; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return areas.filter((area) => !needle || `${area.name_en} ${area.name_bn ?? ""} ${area.id}`.toLowerCase().includes(needle));
  }, [areas, query]);

  const toggle = async (area: AdminArea) => {
    setError(null);
    const reason = area.disabled ? "" : window.prompt("Why should this area be disabled?")?.trim();
    if (!area.disabled && !reason) return;
    setWorkingId(area.id);
    try {
      await adminRequest(`/api/admin/areas/${area.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !area.disabled, disableReason: reason }),
      });
      await onRefresh();
    } catch (requestError) {
      setError(adminErrorMessage(requestError, "The area setting could not be saved."));
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="admin-panel">
      {error ? <div className="admin-error" role="alert">{error}</div> : null}
      <div className="admin-filter"><SearchIcon /><input placeholder="Find an upazila or thana" value={query} onChange={(event) => setQuery(event.target.value)} /><span>{filtered.length}</span></div>
      <div className="admin-area-grid">
        {filtered.map((area) => (
          <article className={area.disabled ? "is-disabled" : ""} key={area.id}>
            <div><span>{area.district_id}</span><h3>{area.name_en}</h3><p>{area.name_bn ?? "No Bangla label"}</p></div>
            <button type="button" disabled={workingId === area.id} onClick={() => toggle(area)}>{workingId === area.id ? "Saving…" : area.disabled ? "Enable" : "Disable"}</button>
            {area.disable_reason ? <small>{area.disable_reason}</small> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function AdminSystem({ settings, onRefresh }: { settings: AdminSettings | null; onRefresh: () => Promise<void> }) {
  const [message, setMessage] = useState(settings?.public_message ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const [killPhrase, setKillPhrase] = useState("");
  useEffect(() => setMessage(settings?.public_message ?? ""), [settings?.public_message]);
  if (!settings) return <p className="admin-empty">Settings unavailable.</p>;

  const update = async (patch: JsonRecord) => {
    setWorking(true);
    setError(null);
    try {
      await adminRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify(patch) });
      await onRefresh();
      return true;
    } catch (requestError) {
      setError(adminErrorMessage(requestError, "The system setting could not be saved."));
      return false;
    } finally {
      setWorking(false);
    }
  };

  const closeKillConfirmation = () => {
    if (working) return;
    setConfirmKill(false);
    setKillPhrase("");
    setError(null);
  };

  const haltSystem = async () => {
    const saved = await update({ siteKillSwitch: true });
    if (saved) {
      setConfirmKill(false);
      setKillPhrase("");
    }
  };

  return (
    <div className="admin-system">
      {!confirmKill && error ? <div className="admin-error" role="alert">{error}</div> : null}
      <article>
        <div><p>Submission intake</p><h2>{settings.submissions_enabled ? "Accepting reports" : "Reports paused"}</h2><span>Pause anonymous report mutations without taking down public reading.</span></div>
        <button className={settings.submissions_enabled ? "" : "is-danger"} disabled={working} type="button" onClick={() => update({ submissionsEnabled: !settings.submissions_enabled })}>{settings.submissions_enabled ? "Pause intake" : "Resume intake"}</button>
      </article>
      <article className="admin-system__kill">
        <div><p>Global kill switch</p><h2>{settings.site_kill_switch ? "Public data halted" : "System available"}</h2><span>Emergency control. Enabling this clears live area states and blocks normal operation.</span></div>
        <button
          className={settings.site_kill_switch ? "" : "is-danger"}
          disabled={working}
          type="button"
          onClick={() => {
            if (settings.site_kill_switch) {
              void update({ siteKillSwitch: false });
            } else {
              setError(null);
              setKillPhrase("");
              setConfirmKill(true);
            }
          }}
        >
          {settings.site_kill_switch ? "Restore system" : "Halt system"}
        </button>
      </article>
      <article className="admin-system__message">
        <div><p>Public service message</p><h2>Temporary notice</h2><span>Optional plain-text message for operational context.</span></div>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="No public message" />
        <button disabled={working} type="button" onClick={() => update({ publicMessage: message })}>Save message</button>
      </article>

      {confirmKill ? (
        <div className="admin-action-overlay" role="presentation" onMouseDown={closeKillConfirmation}>
          <div
            aria-labelledby="admin-kill-title"
            aria-modal="true"
            className="admin-action-dialog admin-kill-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="Close kill switch confirmation"
              className="dialog-close"
              disabled={working}
              onClick={closeKillConfirmation}
              type="button"
            >
              <CloseIcon />
            </button>
            <p>Destructive system action</p>
            <h2 id="admin-kill-title">Halt CurrentJabe?</h2>
            <div className="admin-kill-warning">
              This immediately clears every live area state and stops normal operation. The map
              will need fresh community reports to rebuild those signals after restoration.
            </div>
            <label className="admin-kill-confirmation">
              <span>Type <strong>HALT</strong> to confirm</span>
              <input
                autoFocus
                autoComplete="off"
                disabled={working}
                value={killPhrase}
                onChange={(event) => setKillPhrase(event.target.value)}
              />
            </label>
            {error ? <div className="admin-action-error" role="alert">{error}</div> : null}
            <div className="admin-confirm-actions">
              <button disabled={working} type="button" onClick={closeKillConfirmation}>Cancel</button>
              <button
                className="button-primary"
                disabled={working || killPhrase.trim().toUpperCase() !== "HALT"}
                type="button"
                onClick={() => void haltSystem()}
              >
                {working ? "Halting…" : "Clear live states & halt"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminAudit({ entries, compact = false }: { entries: AuditEntry[]; compact?: boolean }) {
  return (
    <div className={`admin-audit${compact ? " admin-audit--compact" : ""}`}>
      {entries.length === 0 ? <p className="admin-empty">No operator actions yet.</p> : entries.map((entry) => (
        <article key={entry.id}>
          <span className="admin-audit__icon"><CheckIcon /></span>
          <div><strong>{entry.action} · {entry.entity_type}</strong><span>{entry.entity_id}</span>{entry.reason ? <p>{entry.reason}</p> : null}</div>
          <small>{entry.actor}<br />{new Date(entry.created_at).toLocaleString()}</small>
        </article>
      ))}
    </div>
  );
}
