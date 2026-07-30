import { STATUS_LABELS, Status } from "./status";

export interface ReportIssue {
  domain: string;
  status: Status;
  detail: string | null;
  note: string | null;
  screenshotUrl: string | null;
  firstSeenAt: Date;
  isNew: boolean;
}

interface Embed {
  title?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  timestamp?: string;
}

const COLOR_RED = 0xed4245;
const COLOR_ORANGE = 0xe67e22;
const COLOR_GREEN = 0x57f287;

async function postToWebhook(payload: { content?: string; embeds?: Embed[] }): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.warn("[discord] DISCORD_WEBHOOK_URL not set — skipping report");
    return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return;
    if (res.status === 429) {
      const data = await res.json().catch(() => ({ retry_after: 2 }));
      await new Promise((r) => setTimeout(r, ((data.retry_after as number) || 2) * 1000 + 250));
      continue;
    }
    console.error(`[discord] webhook failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return;
  }
}

function issueEmbeds(issues: ReportIssue[], color: number): Embed[] {
  return issues.map((i) => {
    const lines = [i.detail, i.note ? `📝 **Note:** ${i.note}` : null].filter(Boolean) as string[];
    return {
      title: `${i.domain} — ${STATUS_LABELS[i.status] ?? i.status}`,
      description: lines.length > 0 ? lines.join("\n").slice(0, 4000) : undefined,
      color,
      image: i.screenshotUrl ? { url: i.screenshotUrl } : undefined,
    };
  });
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: process.env.TZ || "America/Toronto", year: "numeric", month: "short", day: "numeric" });
}

/**
 * Send the full check report to Discord:
 * - summary line (up/total)
 * - New Issues section
 * - Ongoing issues grouped by the date they were first seen
 * Discord allows max 10 embeds per message, so sections are chunked.
 */
export async function sendReport(opts: {
  total: number;
  upCount: number;
  issues: ReportIssue[];
  trigger: string;
}): Promise<void> {
  const { total, upCount, issues } = opts;
  const errorCount = issues.length;

  const summary =
    errorCount === 0
      ? `✅ **${upCount}/${total} — Up and Running** — no issues found 🎉`
      : `📊 **${upCount}/${total} — Up and Running** · ⚠️ ${errorCount} store${errorCount === 1 ? "" : "s"} with issues`;

  await postToWebhook({
    content: `${summary}\n_Check completed ${new Date().toLocaleString("en-CA", { timeZone: process.env.TZ || "America/Toronto" })} (${opts.trigger})_`,
  });
  if (errorCount === 0) return;

  const newIssues = issues.filter((i) => i.isNew);
  const ongoing = issues.filter((i) => !i.isNew);

  if (newIssues.length > 0) {
    await postToWebhook({ content: `🚨 **New Issues (${newIssues.length})**` });
    await sendEmbedsChunked(issueEmbeds(newIssues, COLOR_RED));
  }

  if (ongoing.length > 0) {
    // group by first-seen date, oldest first
    const groups = new Map<string, ReportIssue[]>();
    for (const issue of ongoing) {
      const key = formatDate(issue.firstSeenAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(issue);
    }
    await postToWebhook({ content: `⏳ **Ongoing Issues (${ongoing.length})**` });
    const sorted = [...groups.entries()].sort(
      (a, b) => (a[1][0].firstSeenAt.getTime() - b[1][0].firstSeenAt.getTime())
    );
    for (const [date, group] of sorted) {
      await postToWebhook({ content: `**Issues since ${date}:**` });
      await sendEmbedsChunked(issueEmbeds(group, COLOR_ORANGE));
    }
  }
}

async function sendEmbedsChunked(embeds: Embed[]): Promise<void> {
  for (let i = 0; i < embeds.length; i += 10) {
    await postToWebhook({ embeds: embeds.slice(i, i + 10) });
    await new Promise((r) => setTimeout(r, 400)); // stay under webhook rate limits
  }
}

/** Notify that issues from previous checks are now resolved. */
export async function sendRecoveries(domains: { domain: string; status: Status }[]): Promise<void> {
  if (domains.length === 0) return;
  await postToWebhook({
    embeds: [
      {
        title: `✅ Recovered (${domains.length})`,
        description: domains.map((d) => `**${d.domain}** — back up`).join("\n").slice(0, 4000),
        color: COLOR_GREEN,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}
