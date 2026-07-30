"use client";

import { useState } from "react";

/**
 * Inline note editor for an open issue. The saved note is included in the
 * Discord report the next time the issue is reported as ongoing.
 */
export function IssueNote({ id, initialNote }: { id: number; initialNote: string | null }) {
  const [note, setNote] = useState(initialNote ?? "");
  const [saved, setSaved] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const dirty = note.trim() !== saved.trim();

  async function save() {
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/issues/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note }),
      });
      if (!res.ok) {
        setError(true);
      } else {
        const data = await res.json();
        setSaved(data.note ?? "");
        setNote(data.note ?? "");
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="issue-note">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note…"
        rows={2}
        className="note-input"
      />
      <div className="note-actions">
        <button className="btn small" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
        {error && <span className="note error">Save failed</span>}
      </div>
    </div>
  );
}
