import cron from "node-cron";
import { runCheck } from "./runner";

declare global {
  // eslint-disable-next-line no-var
  var __schedulerStarted: boolean | undefined;
}

/**
 * Once-daily check. Default: 8 AM America/Toronto.
 * Override with CHECK_CRON (standard cron expression) and TZ.
 */
export function startScheduler(): void {
  if (globalThis.__schedulerStarted) return;
  globalThis.__schedulerStarted = true;

  const expression = process.env.CHECK_CRON || "0 8 * * *";
  const timezone = process.env.TZ || "America/Toronto";

  cron.schedule(
    expression,
    () => {
      console.log("[scheduler] scheduled check starting");
      runCheck("schedule").catch((err) => console.error("[scheduler] scheduled check failed:", err));
    },
    { timezone }
  );
  console.log(`[scheduler] started — cron "${expression}" (${timezone})`);
}
