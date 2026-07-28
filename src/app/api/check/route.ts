import { NextResponse } from "next/server";
import { isRunActive, runCheck } from "@/lib/runner";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** Trigger a manual check run (fire-and-forget; poll /api/check for progress). */
export async function POST() {
  if (isRunActive()) {
    return NextResponse.json({ error: "A check is already running" }, { status: 409 });
  }
  const storeCount = await prisma.store.count();
  if (storeCount === 0) {
    return NextResponse.json({ error: "Upload a domain list first" }, { status: 400 });
  }
  runCheck("manual").catch((err) => console.error("[api/check] run failed:", err));
  return NextResponse.json({ started: true, total: storeCount });
}

/** Current/latest run status for dashboard polling. */
export async function GET() {
  const latest = await prisma.checkRun.findFirst({ orderBy: { startedAt: "desc" } });
  return NextResponse.json({ running: isRunActive(), latest });
}
