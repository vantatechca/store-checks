import { prisma } from "@/lib/db";
import { STATUS_LABELS, Status } from "@/lib/status";
import { Controls } from "./controls";

export const dynamic = "force-dynamic";

const TZ = process.env.TZ || "America/Toronto";

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-CA", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "short", day: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  UP: "#16a34a",
  DNS_ERROR: "#dc2626",
  STORE_UNAVAILABLE: "#ea580c",
  RAW_SHOPIFY_DOMAIN: "#d97706",
  PASSWORD_PROTECTED: "#7c3aed",
  SITE_ERROR: "#be123c",
  TIMEOUT: "#64748b",
  UNKNOWN: "#94a3b8",
};

export default async function Dashboard() {
  const [storeCount, lastRun, openIssues, recentRuns] = await Promise.all([
    prisma.store.count(),
    prisma.checkRun.findFirst({ where: { status: "done" }, orderBy: { startedAt: "desc" } }),
    prisma.issue.findMany({ where: { resolvedAt: null }, orderBy: [{ firstSeenAt: "asc" }, { domain: "asc" }] }),
    prisma.checkRun.findMany({ where: { status: { in: ["done", "failed"] } }, orderBy: { startedAt: "desc" }, take: 14 }),
  ]);

  const breakdown = lastRun
    ? await prisma.checkResult.groupBy({ by: ["status"], where: { runId: lastRun.id }, _count: { status: true } })
    : [];
  const breakdownSorted = [...breakdown].sort((a, b) => b._count.status - a._count.status);

  const aiUsedCount = lastRun
    ? await prisma.checkResult.count({ where: { runId: lastRun.id, aiUsed: true } })
    : 0;

  const uptimePct = lastRun && lastRun.total > 0 ? Math.round((lastRun.upCount / lastRun.total) * 1000) / 10 : null;

  // group open issues by first-seen date for the "issues since" view
  const issueGroups = new Map<string, typeof openIssues>();
  for (const issue of openIssues) {
    const key = fmtDate(issue.firstSeenAt);
    if (!issueGroups.has(key)) issueGroups.set(key, []);
    issueGroups.get(key)!.push(issue);
  }

  return (
    <main className="container">
      <div className="header">
        <div>
          <h1>🛍️ Store Checks</h1>
          <p className="sub">
            Automatic checks at 8 AM &amp; 8 PM ({TZ}) · reports sent to Discord
          </p>
        </div>
        <p className="sub">Last check: {fmt(lastRun?.finishedAt)}</p>
      </div>

      <div className="cards">
        <div className="card">
          <div className="label">Stores Monitored</div>
          <div className="value">{storeCount}</div>
        </div>
        <div className="card">
          <div className="label">Up and Running</div>
          <div className="value green">{lastRun ? `${lastRun.upCount}/${lastRun.total}` : "—"}</div>
          {uptimePct !== null && <div className="hint">{uptimePct}% healthy</div>}
        </div>
        <div className="card">
          <div className="label">Open Issues</div>
          <div className={`value ${openIssues.length > 0 ? "red" : "green"}`}>{openIssues.length}</div>
        </div>
        <div className="card">
          <div className="label">AI Analyses (last run)</div>
          <div className="value">{lastRun ? aiUsedCount : "—"}</div>
          <div className="hint">only ambiguous pages hit the AI</div>
        </div>
      </div>

      <Controls storeCount={storeCount} />

      {breakdownSorted.length > 0 && (
        <div className="panel">
          <h2>Last Run Breakdown</h2>
          <div className="bars">
            {breakdownSorted.map((b) => {
              const pct = lastRun!.total > 0 ? (b._count.status / lastRun!.total) * 100 : 0;
              return (
                <div className="bar-row" key={b.status}>
                  <span>{STATUS_LABELS[b.status as Status] ?? b.status}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.max(pct, 1)}%`, background: STATUS_COLORS[b.status] ?? "#94a3b8" }}
                    />
                  </div>
                  <strong>{b._count.status}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Current Issues {openIssues.length > 0 && `(${openIssues.length})`}</h2>
        {openIssues.length === 0 ? (
          <p className="empty">✅ No open issues — all stores healthy on the last check.</p>
        ) : (
          [...issueGroups.entries()].map(([date, issues]) => (
            <div key={date} style={{ marginBottom: 16 }}>
              <p className="note" style={{ margin: "8px 0", fontWeight: 600 }}>Issues since {date}</p>
              <table>
                <thead>
                  <tr>
                    <th>Domain</th>
                    <th>Issue</th>
                    <th>Detail</th>
                    <th>Screenshot</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.id}>
                      <td>
                        <a href={`https://${issue.domain}`} target="_blank" rel="noreferrer">{issue.domain}</a>
                      </td>
                      <td>
                        <span className="badge error">{STATUS_LABELS[issue.status as Status] ?? issue.status}</span>
                      </td>
                      <td className="note">{issue.detail ?? "—"}</td>
                      <td>
                        {issue.screenshotUrl ? (
                          <a href={issue.screenshotUrl} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img className="thumb" src={issue.screenshotUrl} alt={`${issue.domain} screenshot`} />
                          </a>
                        ) : (
                          <span className="note">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h2>Check History</h2>
        {recentRuns.length === 0 ? (
          <p className="empty">No checks have run yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Result</th>
                <th>Issues</th>
                <th>Duration</th>
                <th>Trigger</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => {
                const mins =
                  run.finishedAt != null
                    ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 60000)
                    : null;
                return (
                  <tr key={run.id}>
                    <td>{fmt(run.startedAt)}</td>
                    <td>
                      {run.status === "failed" ? (
                        <span className="badge error">failed</span>
                      ) : (
                        <span className={`badge ${run.errorCount === 0 ? "up" : "warn"}`}>
                          {run.upCount}/{run.total} up
                        </span>
                      )}
                    </td>
                    <td>{run.errorCount}</td>
                    <td className="note">{mins !== null ? `${mins} min` : "—"}</td>
                    <td className="note">{run.trigger}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
