import pLimit from "p-limit";
import { prisma } from "./db";
import { checkDomain, launchBrowser } from "./checker";
import { uploadScreenshot } from "./cloudinary";
import { sendRecoveries, sendReport, ReportIssue } from "./discord";
import { isErrorStatus, Status } from "./status";

let running = false;

export function isRunActive(): boolean {
  return running;
}

/**
 * Run a full check of every store in the database:
 * - checks domains concurrently (CHECK_CONCURRENCY, default 6)
 * - uploads screenshots to Cloudinary only for stores with errors
 * - updates the Issue table (open/close issues, track first-seen dates)
 * - sends the Discord report
 */
export async function runCheck(trigger: "manual" | "schedule"): Promise<number | null> {
  if (running) {
    console.warn("[runner] a check is already running — skipping");
    return null;
  }
  running = true;

  try {
    const stores = await prisma.store.findMany({ orderBy: { domain: "asc" } });
    if (stores.length === 0) {
      console.warn("[runner] no stores uploaded yet — nothing to check");
      return null;
    }

    const run = await prisma.checkRun.create({
      data: { trigger, total: stores.length, status: "running" },
    });
    console.log(`[runner] run #${run.id} started (${trigger}) — ${stores.length} stores`);

    const browser = await launchBrowser();
    const limit = pLimit(Number(process.env.CHECK_CONCURRENCY || 6));
    let checked = 0;

    try {
      await Promise.all(
        stores.map((store) =>
          limit(async () => {
            let outcome;
            try {
              outcome = await checkDomain(browser, store.domain);
            } catch (err) {
              console.error(`[runner] check crashed for ${store.domain}:`, err);
              outcome = {
                status: "UNKNOWN" as Status,
                detail: `Check failed: ${err instanceof Error ? err.message.slice(0, 140) : "unknown error"}`,
                screenshot: null,
                aiUsed: false,
                durationMs: 0,
              };
            }

            // Screenshots are only kept (uploaded to Cloudinary) when there is an error
            let screenshotUrl: string | null = null;
            if (isErrorStatus(outcome.status) && outcome.screenshot) {
              screenshotUrl = await uploadScreenshot(outcome.screenshot, store.domain);
            }

            await prisma.checkResult.create({
              data: {
                runId: run.id,
                domain: store.domain,
                status: outcome.status,
                detail: outcome.detail,
                screenshotUrl,
                aiUsed: outcome.aiUsed,
                durationMs: outcome.durationMs,
              },
            });

            checked++;
            if (checked % 25 === 0 || checked === stores.length) {
              await prisma.checkRun.update({ where: { id: run.id }, data: { checked } });
              console.log(`[runner] progress ${checked}/${stores.length}`);
            }
          })
        )
      );
    } finally {
      await browser.close().catch(() => {});
    }

    // Tally + reconcile the Issue table
    const results = await prisma.checkResult.findMany({ where: { runId: run.id } });
    const upCount = results.filter((r) => !isErrorStatus(r.status)).length;
    const errored = results.filter((r) => isErrorStatus(r.status));

    const openIssues = await prisma.issue.findMany({ where: { resolvedAt: null } });
    const openByDomain = new Map(openIssues.map((i) => [i.domain, i]));
    const now = new Date();
    const reportIssues: ReportIssue[] = [];
    const recovered: { domain: string; status: Status }[] = [];

    for (const r of errored) {
      const existing = openByDomain.get(r.domain);
      if (existing) {
        // Ongoing issue — keep the original first-seen date (update status if it changed)
        await prisma.issue.update({
          where: { id: existing.id },
          data: {
            status: r.status,
            detail: r.detail,
            lastSeenAt: now,
            screenshotUrl: r.screenshotUrl ?? existing.screenshotUrl,
          },
        });
        reportIssues.push({
          domain: r.domain,
          status: r.status as Status,
          detail: r.detail,
          screenshotUrl: r.screenshotUrl ?? existing.screenshotUrl,
          firstSeenAt: existing.firstSeenAt,
          isNew: false,
        });
      } else {
        const issue = await prisma.issue.create({
          data: {
            domain: r.domain,
            status: r.status,
            detail: r.detail,
            screenshotUrl: r.screenshotUrl,
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        reportIssues.push({
          domain: r.domain,
          status: r.status as Status,
          detail: r.detail,
          screenshotUrl: r.screenshotUrl,
          firstSeenAt: issue.firstSeenAt,
          isNew: true,
        });
      }
    }

    // Close issues for domains that are healthy again (or no longer in the list)
    const erroredDomains = new Set(errored.map((r) => r.domain));
    const checkedDomains = new Set(results.map((r) => r.domain));
    for (const issue of openIssues) {
      if (!erroredDomains.has(issue.domain)) {
        await prisma.issue.update({ where: { id: issue.id }, data: { resolvedAt: now } });
        if (checkedDomains.has(issue.domain)) {
          recovered.push({ domain: issue.domain, status: issue.status as Status });
        }
      }
    }

    await prisma.checkRun.update({
      where: { id: run.id },
      data: { status: "done", finishedAt: now, checked: results.length, upCount, errorCount: errored.length },
    });

    reportIssues.sort((a, b) => a.domain.localeCompare(b.domain));
    await sendReport({ total: results.length, upCount, issues: reportIssues, trigger });
    await sendRecoveries(recovered);

    console.log(`[runner] run #${run.id} done — ${upCount}/${results.length} up, ${errored.length} issues`);
    return run.id;
  } catch (err) {
    console.error("[runner] run failed:", err);
    await prisma.checkRun.updateMany({
      where: { status: "running" },
      data: { status: "failed", finishedAt: new Date() },
    });
    throw err;
  } finally {
    running = false;
  }
}
