"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface RunStatus {
  running: boolean;
  latest: { id: number; status: string; total: number; checked: number } | null;
}

export function Controls({ storeCount }: { storeCount: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [run, setRun] = useState<RunStatus | null>(null);

  const polling = run?.running ?? false;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const res = await fetch("/api/check");
        const data: RunStatus = await res.json();
        setRun(data);
        if (!data.running && timer) {
          clearInterval(timer);
          timer = null;
          router.refresh();
        }
      } catch {}
    };
    poll();
    timer = setInterval(poll, 4000);
    return () => {
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ text: data.error || "Upload failed", kind: "error" });
      } else {
        setMessage({
          text: `Imported ${data.imported} domains — previous list replaced.`,
          kind: "ok",
        });
        router.refresh();
      }
    } catch {
      setMessage({ text: "Upload failed — network error", kind: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function startCheck() {
    setMessage(null);
    const res = await fetch("/api/check", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setMessage({ text: data.error || "Could not start check", kind: "error" });
      return;
    }
    setRun({ running: true, latest: { id: 0, status: "running", total: data.total, checked: 0 } });
    // restart polling by refreshing the page state
    const timer = setInterval(async () => {
      try {
        const r = await fetch("/api/check");
        const d: RunStatus = await r.json();
        setRun(d);
        if (!d.running) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {}
    }, 4000);
  }

  const progress =
    run?.latest && run.latest.total > 0 ? Math.round((run.latest.checked / run.latest.total) * 100) : 0;

  return (
    <div className="panel">
      <h2>Controls</h2>
      <div className="controls">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
        <button className="btn secondary" disabled={uploading || polling} onClick={() => fileRef.current?.click()}>
          {uploading ? "Uploading…" : "📁 Upload Domain List (CSV/Excel)"}
        </button>
        <button className="btn" disabled={polling || storeCount === 0} onClick={startCheck}>
          {polling ? "Check running…" : "▶ Run Check Now"}
        </button>
        <span className="note">
          {storeCount > 0
            ? `${storeCount} domains loaded. Uploading a new file replaces the entire list.`
            : "No domains yet — upload a CSV or Excel file with your store domains."}
        </span>
      </div>
      {message && <p className={`note ${message.kind}`} style={{ marginTop: 10 }}>{message.text}</p>}
      {polling && run?.latest && (
        <div>
          <p className="note" style={{ marginTop: 10 }}>
            Checking {run.latest.checked}/{run.latest.total} stores… report will be sent to Discord when done.
          </p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
