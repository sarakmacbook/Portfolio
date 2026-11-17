import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const table = readFileSync(resolve(__dirname, "../src/components/HoldingsTable.tsx"), "utf8");

test("desktop and mobile groups expose an explicit add-asset action", () => {
  assert.equal(table.match(/insertAssetButton\(section.group.folder\)/g)?.length, 2);
  assert.ok(table.includes('aria-label={`Add asset to ${folder.name}`}'));
  assert.ok(table.includes('htmlFor="group-asset-picker"'));
  assert.ok(table.includes('id="group-asset-picker"'));
  assert.ok(table.includes('assignments[row.id] !== insertFolderId'));
  assert.ok(table.includes('row.id !== insertFolder?.parentAssetId'));
});

test("explicit insertion saves normally but stages changes while arranging", () => {
  const insert = table.slice(table.indexOf("function insertHolding()"), table.indexOf("function insertAssetButton("));
  assert.match(insert, /if \(arranging\) \{\s+fileHolding\(assetId, target.id\)/);
  assert.ok(insert.includes("await saveHoldingFolderAssignment({ assetId, folderId: target.id })"));
  assert.ok(insert.indexOf("if (!result.ok)") < insert.indexOf("setAssignments("));
  assert.ok(insert.includes("setInsertError("));
  assert.ok(insert.includes("next.delete(target.id)"), "inserted holding's group expands");
  assert.match(table, /function fileHolding\([^\n]+\{\s+if \(!arranging\) return/);
  assert.match(table, /function sectionDragProps\([^\n]+\{\s+if \(!arranging\) return/);
});

test("folder headers use asset-sized icons and readable names", () => {
  const header = table.slice(table.indexOf("function groupHeader("), table.indexOf("function sectionMoveControls("));
  assert.ok(header.includes('h-9 w-9 rounded-xl'));
  assert.ok(header.includes('text-sm font-medium text-slate-900'));
  assert.ok(!header.includes('uppercase tracking-wide'));
});
