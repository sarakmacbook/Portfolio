"use client";

import { useId, useRef, useState } from "react";
import { readFolderLogo } from "@/lib/folder-logo";
import {
  FOLDER_COLORS,
  MAX_FOLDER_NAME_LENGTH,
  type FolderIconSettings,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { PRICE_PROVIDERS, PROVIDER_LABELS } from "@/lib/market-prices";
import ExchangeIcon, { FolderIcon } from "./ExchangeIcon";

type FolderAppearance = Pick<HoldingFolder, "name" | "color"> & FolderIconSettings;

export default function FolderEditor({
  folder,
  onSave,
  onCancel,
}: {
  folder: HoldingFolder;
  onSave: (draft: FolderAppearance) => void;
  onCancel: () => void;
}) {
  const [draftName, setDraftName] = useState(folder.name);
  const [draftColor, setDraftColor] = useState(folder.color);
  const [draftIcon, setDraftIcon] = useState<FolderIconSettings>({
    icon: folder.icon,
    glyph: folder.glyph,
    imageDataUrl: folder.imageDataUrl,
  });
  const [preparingLogo, setPreparingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const logoAttempt = useRef(0);
  const logoHelpId = useId();
  const hasLogo = draftIcon.icon === "image";

  function selectIcon(icon: FolderIconSettings) {
    // A slower read must not override a more recent choice.
    logoAttempt.current += 1;
    setPreparingLogo(false);
    setLogoError("");
    setDraftIcon(icon);
  }

  async function selectLogo(file: File) {
    const attempt = ++logoAttempt.current;
    setPreparingLogo(true);
    setLogoError("");
    try {
      const imageDataUrl = await readFolderLogo(file);
      if (attempt === logoAttempt.current) setDraftIcon({ icon: "image", glyph: "", imageDataUrl });
    } catch (error) {
      if (attempt === logoAttempt.current) {
        setLogoError(error instanceof Error ? error.message : "Could not read this JPEG.");
      }
    } finally {
      if (attempt === logoAttempt.current) setPreparingLogo(false);
    }
  }

  function save() {
    if (!preparingLogo) onSave({ name: draftName, color: draftColor, ...draftIcon });
  }

  return (
    <div
      className="mt-3 rounded-xl border border-indigo-200 bg-white p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className="input min-w-0 flex-1"
          placeholder="Folder name (e.g. Long term, Binance, Play money)"
          value={draftName}
          maxLength={MAX_FOLDER_NAME_LENGTH}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          aria-label="Folder name"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary text-xs" disabled={preparingLogo} onClick={save}>
            Save folder
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Colour</span>
        <span className="flex flex-wrap gap-1">
          {FOLDER_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setDraftColor(color)}
              className={`h-5 w-5 rounded-full ring-offset-2 ${
                draftColor === color ? "ring-2 ring-indigo-500" : ""
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Use colour ${color}`}
              aria-pressed={draftColor === color}
            />
          ))}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Icon</span>
        <button
          type="button"
          onClick={() => selectIcon({ icon: "auto", glyph: "" })}
          className={`rounded-lg border px-2 py-1 text-[11px] ${
            draftIcon.icon === "auto" ? "border-indigo-500 text-slate-900" : "border-slate-200 text-slate-500"
          }`}
          aria-pressed={draftIcon.icon === "auto"}
        >
          Letter
        </button>
        {PRICE_PROVIDERS.map((provider) => {
          const selected = draftIcon.icon === "exchange" && draftIcon.glyph === provider;
          return (
            <button
              key={provider}
              type="button"
              onClick={() => selectIcon({ icon: "exchange", glyph: provider })}
              className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] ${
                selected ? "border-indigo-500 text-slate-900" : "border-slate-200 text-slate-500"
              }`}
              aria-pressed={selected}
              title={`Use the ${PROVIDER_LABELS[provider]} logo`}
            >
              <ExchangeIcon provider={provider} color={draftColor} className="h-4 w-4 rounded" />
              {PROVIDER_LABELS[provider]}
            </button>
          );
        })}
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          <span>Custom</span>
          <input
            className="input w-16 py-1 text-center text-sm"
            value={draftIcon.icon === "emoji" ? draftIcon.glyph : ""}
            onChange={(event) => {
              const glyph = event.target.value;
              selectIcon({ icon: glyph ? "emoji" : "auto", glyph });
            }}
            placeholder="🏦"
            maxLength={4}
            aria-label="Custom folder icon (emoji or short text)"
          />
        </label>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          Preview
          <FolderIcon
            folder={{ name: draftName.trim() || folder.name, color: draftColor, ...draftIcon }}
            className="h-9 w-9 rounded-xl [&>span]:text-sm"
          />
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <label className="relative inline-flex">
          <input
            type="file"
            accept="image/jpeg,.jpg,.jpeg"
            aria-describedby={logoHelpId}
            className="peer sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Let the same file be selected again after removal or a failed read.
              event.currentTarget.value = "";
              if (file) void selectLogo(file);
            }}
          />
          <span className="btn-ghost cursor-pointer px-2 py-1 text-xs peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400">
            {hasLogo ? "Replace JPEG logo" : "Upload JPEG logo"}
          </span>
        </label>
        {hasLogo && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => selectIcon({ icon: "auto", glyph: "" })}
          >
            Remove logo
          </button>
        )}
        <p id={logoHelpId} className="text-xs text-slate-500">JPG or JPEG, up to 5 MB.</p>
      </div>
      <p role="status" className="mt-1 text-xs text-slate-500 empty:hidden">
        {preparingLogo ? "Preparing logo…" : hasLogo ? "Save the folder, then save the layout to keep the logo." : ""}
      </p>
      {logoError && <p role="alert" className="mt-2 text-xs text-rose-700">{logoError}</p>}
    </div>
  );
}
