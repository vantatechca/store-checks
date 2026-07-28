import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function normalizeDomain(raw: string): string | null {
  let d = String(raw).trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

/**
 * Upload a CSV/XLSX of store domains. The new list REPLACES the previous one entirely.
 * Domains are picked up from any cell in the sheet that looks like a domain.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  let rows: unknown[][];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    rows = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      rows.push(...(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][]));
    }
  } catch {
    return NextResponse.json({ error: "Could not read the file — make sure it is a valid CSV or Excel file" }, { status: 400 });
  }

  const domains = new Set<string>();
  let skipped = 0;
  for (const row of rows) {
    for (const cell of row) {
      const text = String(cell ?? "").trim();
      if (!text) continue;
      const domain = normalizeDomain(text);
      if (domain) domains.add(domain);
      else if (text.includes(".")) skipped++;
    }
  }

  if (domains.size === 0) {
    return NextResponse.json({ error: "No valid domains found in the file" }, { status: 400 });
  }

  // Replace the entire previous list
  await prisma.$transaction([
    prisma.store.deleteMany({}),
    prisma.store.createMany({ data: [...domains].sort().map((domain) => ({ domain })) }),
  ]);

  return NextResponse.json({ imported: domains.size, skipped, replaced: true });
}
