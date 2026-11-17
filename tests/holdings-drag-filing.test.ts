import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { assignHolding, groupByFolder, splitByFolder } from "../src/lib/holdings-folders";

const rootDir = resolve(__dirname, "..");
const read = (file: string) => readFileSync(join(rootDir, file), "utf8");

test("dragging a holding onto a group files it and keeps the group order", () => {
  const folders = [
    { id: "a", name: "A", color: "#6366f1", icon: "auto" as const, glyph: "", collapsed: false },
    { id: "b", name: "B", color: "#0ea5e9", icon: "auto" as const, glyph: "", collapsed: false },
  ];
  const rows = [
    { id: 1, value: 100 },
    { id: 2, value: 50 },
    { id: 3, value: 25 },
  ];
  const before = { 1: "a" };
  const after = assignHolding(before, 2, "b");

  // Only real folders are groups — holdlings in no folder are plain rows.
  const start = splitByFolder(rows, folders, before);
  assert.deepEqual(start.groups.map((g) => g.folder.id), ["a"]);
  assert.deepEqual(start.ungrouped.map((row) => row.id), [2, 3]);

  const next = splitByFolder(rows, folders, after);
  assert.deepEqual(next.groups.map((g) => g.folder.id), ["a", "b"]);
  assert.deepEqual(next.groups[1].rows.map((row) => row.id), [2]);
  assert.deepEqual(next.ungrouped.map((row) => row.id), [3]);
  // The original map is untouched, so an optimistic update can be rolled back.
  assert.deepEqual(before, { 1: "a" });
});

test("choosing \"No folder\" pulls a holding back out of its folder", () => {
  const folders = [
    { id: "a", name: "A", color: "#6366f1", icon: "auto" as const, glyph: "", collapsed: false },
  ];
  const rows = [{ id: 1, value: 10 }];
  const filed = { 1: "a" };
  assert.equal(splitByFolder(rows, folders, filed).groups[0].folder.id, "a");

  const ungrouped = assignHolding(filed, 1, null);
  assert.deepEqual(ungrouped, {});
  // With nothing filed there are no groups at all and the row is a plain row.
  const split = splitByFolder(rows, folders, ungrouped);
  assert.deepEqual(split.groups, []);
  assert.deepEqual(split.ungrouped.map((row) => row.id), [1]);
});

test("filing and section arrangement require Arrange layout mode", () => {
  const table = read("src/components/HoldingsTable.tsx");
  for (const name of ["holdingDragProps", "groupDropProps", "sectionDragProps", "commitSectionOrder", "fileHolding", "sectionMoveControls", "viewDragHandle"]) {
    assert.match(table, new RegExp(`function ${name}\\([^\\n]+\\{\\n    if \\(!arranging\\) return`), `${name} must be gated`);
  }
  const control = table.slice(table.indexOf("function folderControl("), table.indexOf("function sectionMoveControls("));
  assert.match(control, /if \(arranging\) \{/);
  assert.ok(!control.includes("arranging || hasFolders"));
  assert.ok(table.includes("const orderedSections = useMemo<HoldingSection[]>("));
  assert.equal((table.match(/orderedSections\.map\(/g) ?? []).length, 2);
});

test("normal-view folder chips cannot accept filing drops", () => {
  const strip = read("src/components/HoldingsFolders.tsx");
  for (const name of ["handleHoldingDrop", "allowHoldingDrop"]) {
    assert.match(strip, new RegExp(`function ${name}\\([^\\n]+\\{\\n    if \\(!arranging\\) return`));
  }
  assert.ok(strip.includes("onFileHolding"));
});

test("the filing action validates the holding and the folder before writing", () => {
  const actions = read("src/app/actions.ts");
  assert.ok(actions.includes("export async function saveHoldingFolderAssignment("));
  assert.ok(
    actions.includes("setHoldingFolder(Number(input?.assetId)"),
    "the action delegates to the storage helper",
  );
  assert.ok(actions.includes("refresh();"), "the dashboard is revalidated");

  const db = read("src/lib/dashboard-order-db.ts");
  assert.ok(db.includes("export async function setHoldingFolder("));
  assert.ok(db.includes('"Unknown holding."'), "a non-numeric id is rejected");
  assert.ok(db.includes('"That holding no longer exists."'), "a deleted holding is rejected");
  assert.ok(db.includes('"That folder no longer exists."'), "a stale folder is rejected");
  assert.ok(
    db.includes("assignHolding(current, assetId, target)"),
    "only the one assignment is changed",
  );
});
