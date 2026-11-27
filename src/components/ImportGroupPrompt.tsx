"use client";

import { useState, type FormEvent } from "react";
import { MAX_FOLDER_NAME_LENGTH } from "@/lib/holdings-folders";
import { Modal } from "./ui";

/**
 * Asked once per API/wallet import, right after the review step: name a group
 * for the rows about to be imported, or skip and let them land as plain
 * holdings. Mounted only while it is open, so every import starts from the
 * suggested name rather than the last one typed.
 */
export default function ImportGroupPrompt({
  count,
  sourceName,
  existingGroups,
  busy,
  onCancel,
  onConfirm,
  onSkip,
}: {
  count: number;
  /** Connection name, used as the suggested group name. */
  sourceName: string;
  /** Root group names already in the portfolio — a match is reused, not duplicated. */
  existingGroups: readonly string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (name: string) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(() => sourceName.trim().slice(0, MAX_FOLDER_NAME_LENGTH));
  const wanted = name.trim();
  const existing = wanted
    ? existingGroups.find((group) => group.toLowerCase() === wanted.toLowerCase())
    : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wanted || busy) return;
    onConfirm(wanted);
  }

  return (
    <Modal open onClose={busy ? () => {} : onCancel} title="Name a group for this import">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">
          Keep these {count} {count === 1 ? "holding" : "holdings"} together on the dashboard by saving them
          in a group. You can rename, re-icon or remove it later from <strong>Holdings</strong>.
        </p>

        <div>
          <label className="label" htmlFor="import-group-name">
            Group name
          </label>
          <input
            id="import-group-name"
            className="input"
            value={name}
            maxLength={MAX_FOLDER_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nansen wallet"
            autoComplete="off"
            autoFocus
            required
          />
          <p className="mt-1 text-xs text-slate-400">
            {existing
              ? `“${existing}” already exists — these holdings will be added to that existing group.`
              : `Up to ${MAX_FOLDER_NAME_LENGTH} characters. A name that matches an existing group reuses it.`}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row-reverse">
          <button type="submit" className="btn-primary" disabled={!wanted || busy}>
            {busy ? "Importing…" : "Create group & import"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onSkip}
            disabled={busy}
            title="Import the holdings without a group"
          >
            Skip — import without a group
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-400">
          Skipping adds them as plain rows in the ungrouped section. You can still drag them into a group
          later, or create one from the Holdings table.
        </p>
      </form>
    </Modal>
  );
}
