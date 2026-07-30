import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** Save (or clear) the note on an open issue. Body: { id: number, note: string }. */
export async function POST(req: NextRequest) {
  let body: { id?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid issue id" }, { status: 400 });
  }

  // Trim; an empty note clears it (stored as null).
  const raw = typeof body.note === "string" ? body.note.trim() : "";
  const note = raw.length > 0 ? raw.slice(0, 2000) : null;

  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  await prisma.issue.update({ where: { id }, data: { note } });
  return NextResponse.json({ id, note });
}
