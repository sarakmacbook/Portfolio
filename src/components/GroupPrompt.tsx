"use client";

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { readFolderLogo } from "@/lib/folder-logo";
import type { GroupPromptRow, HoldingsGroupRequest } from "@/lib/holdings-group";
import { MAX_FOLDER_NAME_LENGTH, type FolderIconSettings } from "@/lib/holdings-folders";
import { money } from "@/lib/format";
import { FolderIcon } from "./ExchangeIcon";
import { Modal } from "./ui";

const NO_ICON: FolderIconSettings = { icon: "auto", glyph: "" };

/**
 * The "save these holdings as a group" dialog, shared by the API import review
 * step and every exchange sync: name a group, give it a logo, tick the holdings
 * that belong in it — or skip and leave every row ungrouped.
 *
 * Mounted only while it is open, so each sync or import starts from a suggested
 * name and a fully ticked list rather than the last answer.
 */
export default function GroupPrompt({
  rows,
  suggestedName,
  existingGroups,
  busy,
  onCancel,
  onConfirm,
  onSkip,
}: {
  /** The holdings on offer, already narrowed to what this import or sync touched. */
  rows: readonly GroupPromptRow[];
  /** Suggested group name — the connection or exchange name. */
  suggestedName: string;
  /** Root group names already in the portfolio — a match is reused, not duplicated. */
  existingGroups: readonly string[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (request: HoldingsGroupRequest) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(() => suggestedName.trim().slice(0, MAX_FOLDER_NAME_LENGTH));
  const [icon, setIcon] = useState<FolderIconSettings>(NO_ICON);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.map((row) => row.key)),
  );
  const [preparingLogo, setPreparingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const logoAttempt = useRef(0);
  const logoHelpId = useId();

  const wanted = name.trim();
  const existing = wanted
    ? existingGroups.find((group) => group.toLowerCase() === wanted.toLowerCase())
    : undefined;
  const hasLogo = icon.icon === "image";

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.symbol.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.label.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const selectedCount = rows.filter((row) => selected.has(row.key)).length;

  function toggle(row: GroupPromptRow) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  }

  /** Ticks or unticks the rows the filter is showing — the same rule the review table uses. */
  function selectVisible(shouldSelect: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of visibleRows) {
        if (shouldSelect) next.add(row.key);
        else next.delete(row.key);
      }
      return next;
    });
  }

  async function selectLogo(file: File) {
    const attempt = ++logoAttempt.current;
    setPreparingLogo(true);
    setLogoError("");
    try {
      const imageDataUrl = await readFolderLogo(file);
      if (attempt === logoAttempt.current) setIcon({ icon: "image", glyph: "", imageDataUrl });
    } catch (error) {
      if (attempt === logoAttempt.current) {
        setLogoError(error instanceof Error ? error.message : "Could not read this image.");
      }
    } finally {
      if (attempt === logoAttempt.current) setPreparingLogo(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wanted || selectedCount === 0 || busy || preparingLogo) return;
    onConfirm({
      name: wanted,
      // Only the ticked rows are filed; the rest stay ungrouped.
      assetKeys: rows.filter((row) => selected.has(row.key)).map((row) => row.key),
      ...(icon.icon === "auto" ? {} : { icon: { icon: icon.icon, glyph: icon.glyph, imageDataUrl: icon.imageDataUrl } }),
    });
  }

  const previewFolder = { name: wanted || "Group", color: "#6366f1", ...icon };

  return (
    <Modal open wide onClose={busy ? () => {} : onCancel} title="Save these holdings as a group">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">
          Keep the holdings you tick together on the dashboard by saving them in a group. Nothing is
          duplicated — a group is a label, and you can rename, re-icon or remove it later from{" "}
          <strong>Holdings</strong>.
        </p>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="import-group-name">
              Group name
            </label>
            <input
              id="import-group-name"
              className="input"
              value={name}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              placeholder="Long term, Binance, Play money…"
              autoComplete="off"
              autoFocus
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              {existing
                ? `“${existing}” already exists — these holdings will be added to it and its logo is kept.`
                : `Up to ${MAX_FOLDER_NAME_LENGTH} characters. A name that matches an existing group reuses it.`}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <FolderIcon folder={previewFolder} className="h-11 w-11 rounded-xl [&>span]:text-sm" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative inline-flex">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                    aria-describedby={logoHelpId}
                    className="peer sr-only"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      // Let the same file be picked again after a removal or failed read.
                      event.currentTarget.value = "";
                      if (file) void selectLogo(file);
                    }}
                    disabled={busy || preparingLogo}
                  />
                  <span className="btn-ghost cursor-pointer px-2 py-1 text-xs peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400">
                    {hasLogo ? "Replace logo" : "Upload logo"}
                  </span>
                </label>
                {hasLogo && (
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-xs"
                    onClick={() => {
                      logoAttempt.current += 1;
                      setPreparingLogo(false);
                      setLogoError("");
                      setIcon(NO_ICON);
                    }}
                    disabled={busy}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p id={logoHelpId} className="mt-1 max-w-56 text-[11px] leading-snug text-slate-400">
                {preparingLogo
                  ? "Preparing logo…"
                  : hasLogo
                    ? "Saved as a small JPEG when the group is created."
                    : "Optional. JPG, PNG, WebP or GIF, up to 5 MB. Without one, the group shows its initial."}
              </p>
              {logoError && (
                <p role="alert" className="mt-1 text-[11px] text-rose-600">
                  {logoError}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-600">
              {selectedCount} of {rows.length} going into the group
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => selectVisible(true)}
                disabled={busy || visibleRows.length === 0}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                onClick={() => selectVisible(false)}
                disabled={busy || visibleRows.length === 0}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="px-3 py-2">
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by symbol, name or source"
              aria-label="Filter the holdings in this group"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {visibleRows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              No holdings match “{query.trim()}”. Clear the filter to see them all.
            </p>
          ) : (
            <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto">
              {visibleRows.map((row) => (
                <li key={row.key}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50/70">
                    <input
                      type="checkbox"
                      checked={selected.has(row.key)}
                      onChange={() => toggle(row)}
                      disabled={busy}
                      className="h-4 w-4 shrink-0 accent-indigo-600"
                      aria-label={`Put ${row.symbol} in the group`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{row.symbol}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {row.name}
                        {row.label ? ` · ${row.label}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {row.value > 0 ? money(row.value) : "—"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-500">
            Unticked holdings are still kept — they just stay ungrouped. Select all / Clear applies to
            the rows the filter shows.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row-reverse">
          <button
            type="submit"
            className="btn-primary"
            disabled={!wanted || selectedCount === 0 || busy || preparingLogo}
          >
            {busy ? "Saving…" : `Create group & add ${selectedCount}`}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onSkip}
            disabled={busy}
            title="Leave every holding ungrouped"
          >
            Skip — leave them ungrouped
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-400">
          {selectedCount === 0
            ? "Tick at least one holding to create the group, or skip to leave them all as plain rows."
            : `Skipping leaves all ${rows.length} as plain rows in the ungrouped section. You can still drag them into a group later.`}
        </p>
      </form>
    </Modal>
  );
}
