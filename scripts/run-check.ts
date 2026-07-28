/** Run a single check from the command line: `npm run check:once` */
import { runCheck } from "../src/lib/runner";

runCheck("manual")
  .then((runId) => {
    console.log(runId ? `Check run #${runId} complete.` : "No check performed.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
  });
