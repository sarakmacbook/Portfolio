"use client";

import { useState, useTransition, type DragEvent } from "react";
import { clearAllHoldingGroups, createHoldingGroup } from "@/app/actions";
import {
  MAX_FOLDERS,
  MAX_FOLDER_NAME_LENGTH,
  matchesFolderFilter,
  removeFolder,
  UNGROUPED_SECTION_KEY,
  updateFolder,
  type FolderAssignments,
  type FolderFilter,
  type HoldingFolder,
} from "@/lib/holdings-folders";
import { money } from "@/lib/format";
import { FolderIcon } from "./ExchangeIcon";
import FolderEditor from "./FolderEditor";
import GripIcon from "./GripIcon";

/**
 * The folder strip above the Holdings table.
 *
 * Outside arrange mode it is a filter bar: **All** and one chip per folder with
 * its count and value. Inside arrange mode the chips become draggable (and
 * nudgeable with ◀ / ▶), can be renamed, recoloured, given a custom icon, and
 * deleted — and a holding dragged from the table can be dropped
 * straight onto a folder to file it.
 *
 * Groups are created from the **＋ Add group** button inside arrange mode (a
 * quick name field that persists at once) or from the **Add holding** /
 * **Edit** forms ("Create a new folder…"); the normal-view strip only
 * filters. In arrange mode the strip also arranges where each block of rows
 * sits in the table: one pill per section — the folder groups and the
 * ungrouped rows — in top-to-bottom order, so a group can be moved above or
 * below the plain rows. Dropping a holding on the ungrouped pill pulls it out
 * of its folder. Filing goes through `onFileHolding`, so the table decides
 * whether a drop is pending (arrange mode, saved by **Save layout**) or
 * persisted straight away (normal view). Folder edits made in arrange mode
 * are deferred to that save; quick creation and section order are too.
 */
export default function HoldingsFolders({
  folders,
  allFolders,
  assignments,
  counts,
  totals,
  selected,
  onSelect,
  arranging,
  onFoldersChange,
  sections,
  onSectionsChange,
  sectionDrag,
  onSectionDragChange,
  ungroupedCount,
  onAssignmentsChange,
  onGroupsCleared,
  onFileHolding,
  totalRows,
}: {
  folders: HoldingFolder[];
  /** Full inventory, including folders nested under assets. */
  allFolders: HoldingFolder[];
  assignments: FolderAssignments;
  /** Holdings per folder id. */
  counts: Record<string, number>;
  /** Portfolio value per folder id. */
  totals: Record<string, number>;
  selected: FolderFilter;
  onSelect: (next: FolderFilter) => void;
  arranging: boolean;
  onFoldersChange: (next: HoldingFolder[]) => void;
  /** Section order for arrange mode: folder ids plus the ungrouped key. */
  sections: string[];
  onSectionsChange: (next: string[]) => void;
  /**
   * The section being dragged right now — shared with the table so a group row
   * dragged there lights the pills up as drop targets too (and vice versa).
   */
  sectionDrag: string | null;
  onSectionDragChange: (key: string | null) => void;
  /** Holdings in no folder — the count on the ungrouped pill. */
  ungroupedCount: number;
  onAssignmentsChange: (next: FolderAssignments) => void;
  onGroupsCleared: () => void;
  /** Files one holding (drag-and-drop); `null` pulls it out of its folder. */
  onFileHolding: (assetId: number, folderId: string | null) => void;
  /** Total number of holdings, shown on the **All** chip. */
  totalRows: number;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [groupError, setGroupError] = useState("");
  const [clearError, setClearError] = useState("");
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [savingGroup, startSavingGroup] = useTransition();
  const [clearingGroups, startClearingGroups] = useTransition();

  /** The editor exists only while arranging; changes are saved with the layout. */
  const editingFolder = arranging ? folders.find((folder) => folder.id === editing) : undefined;
  /** The quick group form lives in the strip itself, in either mode. */
  const showQuickCreate = creating;

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setDraftName("");
    setGroupError("");
  }

  function commitQuickCreate() {
    if (savingGroup || !draftName.trim()) return;
    setGroupError("");
    startSavingGroup(async () => {
      const result = await createHoldingGroup(draftName);
      if (!result.ok || !result.folder) {
        setGroupError(result.error ?? "Could not create the group.");
        return;
      }
      onFoldersChange([result.folder, ...folders]);
      setDraftName("");
      setCreating(false);
      setAnnouncement(`${result.folder.name} group created.`);
    });
  }

  function startEdit(folder: HoldingFolder) {
    setCreating(false);
    setEditing(folder.id);
  }

  function clearGroups() {
    if (clearingGroups) return;
    setClearError("");
    startClearingGroups(async () => {
      const result = await clearAllHoldingGroups();
      if (!result.ok) {
        setClearError(result.error ?? "Could not remove the groups.");
        return;
      }
      onGroupsCleared();
      setConfirmClearAll(false);
      setAnnouncement("All groups removed. Holdings remain in the portfolio and are now ungrouped.");
    });
  }

  function deleteFolder(folder: HoldingFolder) {
    const { folders: nextFolders, assignments: nextAssignments } = removeFolder(
      folders,
      assignments,
      folder.id,
    );
    onFoldersChange(nextFolders);
    onAssignmentsChange(nextAssignments);
    if (selected === `folder:${folder.id}`) onSelect("all");
    setAnnouncement(`${folder.name} deleted. Its holdings are back in the list.`);
    setEditing(null);
  }

  function sectionLabel(key: string) {
    if (key === UNGROUPED_SECTION_KEY) return "Ungrouped rows";
    return folders.find((folder) => folder.id === key)?.name ?? "Folder";
  }

  /** Nudges a section (a folder pill or the ungrouped block) left/right. */
  function moveSectionBy(key: string, delta: number) {
    const from = sections.indexOf(key);
    const to = Math.max(0, Math.min(sections.length - 1, from + delta));
    if (from < 0 || to === from) return;
    const next = [...sections];
    next.splice(from, 1);
    next.splice(to, 0, key);
    onSectionsChange(next);
    setAnnouncement(`${sectionLabel(key)} moved to position ${to + 1} of ${next.length}.`);
  }

  function handleSectionDrop() {
    if (!sectionDrag || !drop || sectionDrag === drop.id) {
      onSectionDragChange(null);
      setDrop(null);
      return;
    }
    const from = sections.indexOf(sectionDrag);
    const target = sections.indexOf(drop.id);
    if (from < 0 || target < 0) {
      onSectionDragChange(null);
      setDrop(null);
      return;
    }
    const next = [...sections];
    next.splice(from, 1);
    const at = next.indexOf(drop.id) + (drop.after ? 1 : 0);
    next.splice(at, 0, sectionDrag);
    onSectionsChange(next);
    setAnnouncement(
      `${sectionLabel(sectionDrag)} moved to position ${at + 1} of ${next.length}.`,
    );
    onSectionDragChange(null);
    setDrop(null);
  }

  /** A holding dragged out of the table (text/plain = asset id) was dropped here. */
  function handleHoldingDrop(event: DragEvent<HTMLElement>, sectionKey: string) {
    if (!arranging) return;
    const raw = event.dataTransfer.getData("text/plain");
    const assetId = Number(raw);
    if (!Number.isInteger(assetId) || assetId <= 0) return;
    event.preventDefault();
    // Dropping on the ungrouped block pulls the holding out of its folder.
    onFileHolding(assetId, sectionKey === UNGROUPED_SECTION_KEY ? null : sectionKey);
    setDropFolder(null);
  }

  function allowHoldingDrop(event: DragEvent<HTMLElement>, folderId: string) {
    if (!arranging) return;
    // Only react to holdings: a folder or category drag carries its own key.
    const raw = event.dataTransfer.types.includes("text/plain");
    if (!raw) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropFolder(folderId);
  }

  /**
   * The solid create button — shown in the normal-view strip and again inside
   * arrange mode, so a group can be started without leaving the layout editor.
   * It persists at once in both modes (quick create is never pending).
   */
  function createButton() {
    if (creating) return null;
    return (
      <button
        type="button"
        className="btn-primary text-xs"
        onClick={startCreate}
        disabled={savingGroup || allFolders.length >= MAX_FOLDERS}
        title={`Create a group for holdings (up to ${MAX_FOLDERS})`}
      >
        ＋ Add group
      </button>
    );
  }

  /**
   * One pill per section while arranging: folder pills (drag, nudge, edit,
   * delete) plus the ungrouped-rows block, which moves like any other section
   * and doubles as a drop target that pulls a holding out of its folder. The
   * pill order is the table's top-to-bottom section order.
   */
  function sectionPill(key: string, position: number) {
    const folder =
      key === UNGROUPED_SECTION_KEY ? undefined : folders.find((item) => item.id === key);
    if (key !== UNGROUPED_SECTION_KEY && !folder) return null;
    const isDragging = sectionDrag === key;
    const isDropTarget = drop?.id === key && !isDragging;
    const label = folder ? folder.name : "Ungrouped rows";
    const count = folder ? (counts[folder.id] ?? 0) : ungroupedCount;
    return (
      <div
        key={key}
        onDragOver={(event) => {
          if (sectionDrag) {
            if (sectionDrag === key) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            const after = event.clientX - rect.left > rect.width / 2;
            setDrop((current) =>
              current?.id === key && current.after === after ? current : { id: key, after },
            );
            return;
          }
          allowHoldingDrop(event, key);
        }}
        onDragLeave={() => setDropFolder((current) => (current === key ? null : current))}
        onDrop={(event) => {
          if (sectionDrag) {
            event.preventDefault();
            handleSectionDrop();
            return;
          }
          handleHoldingDrop(event, key);
        }}
        className={`flex items-center gap-1 rounded-xl border border-dashed px-2 py-1 ${
          folder ? "border-indigo-300 bg-indigo-50/80" : "border-slate-300 bg-slate-50"
        } ${isDragging ? "opacity-50" : ""} ${
          isDropTarget || dropFolder === key
            ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-50"
            : ""
        }`}
      >
        <span
          draggable
          onDragStart={(event) => {
            onSectionDragChange(key);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", `section:${key}`);
          }}
          onDragEnd={() => {
            onSectionDragChange(null);
            setDrop(null);
          }}
          className="flex cursor-grab items-center gap-1.5 text-xs font-medium text-indigo-900 active:cursor-grabbing"
          title={`Drag to move ${label}`}
        >
          <GripIcon className="h-3 w-2" />
          {folder ? (
            <FolderIcon folder={folder} className="h-4 w-4 rounded" />
          ) : (
            <span aria-hidden="true" className="text-[10px]">
              ≡
            </span>
          )}
          <span className="max-w-24 truncate">{label}</span>
          <span className="text-[10px] tabular-nums text-indigo-700/70">{count}</span>
        </span>
        <span className="flex items-center">
          <button
            type="button"
            className="grid h-5 w-4 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
            onClick={() => moveSectionBy(key, -1)}
            disabled={position === 0}
            aria-label={`Move ${label} left`}
          >
            ◀
          </button>
          <button
            type="button"
            className="grid h-5 w-4 place-items-center rounded text-[9px] text-indigo-700 hover:bg-white disabled:opacity-30"
            onClick={() => moveSectionBy(key, 1)}
            disabled={position === sections.length - 1}
            aria-label={`Move ${label} right`}
          >
            ▶
          </button>
          {folder && (
            <>
              <button
                type="button"
                className="grid h-5 w-5 place-items-center rounded text-[10px] text-indigo-700 hover:bg-white"
                onClick={() => startEdit(folder)}
                aria-label={`Edit ${folder.name}`}
              >
                ✎
              </button>
              <button
                type="button"
                className="grid h-5 w-5 place-items-center rounded text-[10px] text-rose-600 hover:bg-white"
                onClick={() => deleteFolder(folder)}
                aria-label={`Delete ${folder.name}`}
              >
                ✕
              </button>
            </>
          )}
        </span>
      </div>
    );
  }

  const chipClass = (active: boolean) =>
    `group flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition ${
      active
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
    }`;

  return (
    <div className="border-b border-slate-100 px-4 pb-3">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {!arranging && (
          <>
            {folders.length > 0 && (
              <button
                type="button"
                onClick={() => onSelect("all")}
                className={chipClass(selected === "all")}
                aria-pressed={selected === "all"}
              >
                All
                <span className={selected === "all" ? "opacity-70" : "text-slate-400"}>{totalRows}</span>
              </button>
            )}
            {folders.map((folder) => {
              const value = `folder:${folder.id}`;
              const active = selected === value;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => onSelect(active ? "all" : (value as FolderFilter))}
                  className={chipClass(active)}
                  aria-pressed={active}
                  title={`${folder.name} · ${money(totals[folder.id] ?? 0)}`}
                  onDragOver={(event) => allowHoldingDrop(event, folder.id)}
                  onDragLeave={() => setDropFolder((current) => (current === folder.id ? null : current))}
                  onDrop={(event) => handleHoldingDrop(event, folder.id)}
                >
                  <FolderIcon
                    folder={folder}
                    className={`h-4 w-4 rounded ${
                      dropFolder === folder.id ? "ring-2 ring-indigo-400" : ""
                    }`}
                  />
                  <span className="max-w-28 truncate">{folder.name}</span>
                  <span className={active ? "opacity-70" : "text-slate-400"}>
                    {counts[folder.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </>
        )}

        {!arranging && allFolders.length > 0 && (
          <button
            type="button"
            className="rounded-xl border border-transparent px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:border-rose-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setClearError("");
              setConfirmClearAll(true);
            }}
            disabled={clearingGroups}
          >
            Remove all groups
          </button>
        )}

        {arranging && (
          <>
            {sections.map((key, position) => sectionPill(key, position))}
            {createButton()}
            {sections.length > 0 && (
              <span className="text-[11px] text-indigo-700/70">
                Drag a holding onto a folder to file it — drop it on Ungrouped rows to unfile
              </span>
            )}
          </>
        )}
      </div>

      {confirmClearAll && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-medium text-rose-900">
            Remove all {allFolders.length} groups, including folders inside asset pages?
          </p>
          <p className="mt-1 text-xs text-rose-800">
            Holdings will not be deleted; they will remain in your portfolio without groups.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary bg-rose-600 text-xs hover:bg-rose-700"
              onClick={clearGroups}
              disabled={clearingGroups}
            >
              {clearingGroups ? "Removing…" : "Remove all groups"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setConfirmClearAll(false)}
              disabled={clearingGroups}
            >
              Cancel
            </button>
          </div>
          {clearError && <p role="alert" className="mt-2 text-sm text-rose-800">{clearError}</p>}
        </div>
      )}

      {showQuickCreate && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="input min-w-0 flex-1"
              placeholder="Group name (e.g. Long term, Retirement)"
              value={draftName}
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitQuickCreate();
                }
                if (event.key === "Escape") setCreating(false);
              }}
              aria-label="New holdings group name"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={commitQuickCreate}
                disabled={savingGroup || !draftName.trim()}
              >
                {savingGroup ? "Creating…" : "Create group"}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setCreating(false);
                  setGroupError("");
                }}
                disabled={savingGroup}
              >
                Cancel
              </button>
            </div>
          </div>
          {groupError && <p role="alert" className="mt-2 text-sm text-rose-700">{groupError}</p>}
          <p className="mt-2 text-xs text-slate-500">
            The group will be added to Holdings now. You can file assets into it from the table.
          </p>
        </div>
      )}

      {editingFolder && (
        <FolderEditor
          key={editingFolder.id}
          folder={editingFolder}
          onCancel={() => setEditing(null)}
          onSave={(draft) => {
            onFoldersChange(updateFolder(folders, editingFolder.id, draft));
            setAnnouncement(`${draft.name.trim() || editingFolder.name} updated.`);
            setEditing(null);
          }}
        />
      )}

    </div>
  );
}

export { matchesFolderFilter };
