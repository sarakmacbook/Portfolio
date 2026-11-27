import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const table = readFileSync(resolve(__dirname, "../src/components/HoldingsTable.tsx"), "utf8");
const page = readFileSync(resolve(__dirname, "../src/app/page.tsx"), "utf8");
const dialog = readFileSync(resolve(__dirname, "../src/components/AddAssetDialog.tsx"), "utf8");

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
  assert.ok(insert.includes("next.add(target.id)"), "inserted holding's group opens so the row is visible");
  assert.match(table, /function fileHolding\([^\n]+\{\s+if \(!arranging\) return/);
  assert.match(table, /function sectionDragProps\([^\n]+\{\s+if \(!arranging\) return/);
});

test("folder headers use asset-sized icons and readable names", () => {
  const header = table.slice(table.indexOf("function groupHeader("), table.indexOf("function sectionMoveControls("));
  assert.ok(header.includes('h-9 w-9 rounded-xl'));
  assert.ok(header.includes('text-sm font-medium text-slate-900'));
  assert.ok(!header.includes('uppercase tracking-wide'));
});

test("a group can create a brand-new asset filed straight into it", () => {
  // The existing "+ Add asset" action files an existing holding; the new
  // button opens the full add-asset form with this group preselected.
  assert.equal(table.match(/newAssetButton\(section.group.folder\)/g)?.length, 2);
  const create = table.slice(table.indexOf("function newAssetButton("), table.indexOf("function folderControl("));
  assert.ok(create.includes("if (!folderChoices.some((choice) => choice.id === folder.id)) return null"));
  assert.ok(create.includes("<AddAssetDialog"));
  assert.ok(create.includes("defaultFolderId={folder.id}"));
  assert.ok(create.includes("allowCreateFolder={false}"));
  assert.ok(create.includes("Create a new asset in ${folderLabel(folder)}"));
  assert.ok(create.includes("＋ New"));
  assert.ok(page.includes("cashAccounts={cashAccounts}"), "the dialog gets real cash accounts");
  assert.ok(page.includes("folderChoices={foldersForDialog}"), "the dialog gets the saved folders");
  assert.ok(dialog.includes("title={title}"), "the trigger names its target group");
});

test("group headers report the P/L of their own holdings, and grouped rows show the hierarchy", () => {
  const header = table.slice(table.indexOf("function groupHeader("), table.indexOf("function sectionMoveControls("));
  assert.ok(header.includes("group.rows.reduce((sum, row) => sum + row.pnl, 0)"));
  assert.ok(header.includes("money(groupPnl, { sign: true })"));
  assert.ok(header.includes("Unrealized P/L of the holdings in this group"));
  assert.ok(table.includes("renderDesktopRow(r, { key: section.key, position }, true)"));
  assert.ok(table.includes("renderMobileCard(r, { key: section.key, position }, true)"));
  assert.ok(table.includes("border-indigo-100"));
});

test("group folder icons line up with asset logos, and the collapse arrow sits on the right", () => {
  const header = table.slice(table.indexOf("function groupHeader("), table.indexOf("function sectionMoveControls("));
  // A transparent spacer stands in for the desktop row's hover grip so both
  // icons start at the same x; phones have no grip and therefore no spacer.
  assert.ok(header.includes('!arranging && <span className="hidden w-2.5 shrink-0 md:block"'));
  assert.ok(!header.includes('w-3 text-[10px] text-slate-400">{isCollapsed'));
  assert.ok(header.indexOf("money(group.totalValue)") < header.indexOf('isCollapsed ? "▶" : "▼"'));
  // Grouped rows keep the rail/background, but no extra indent: the folder and
  // its assets share one left edge in both the table and the phone list.
  assert.ok(!table.includes('pl-7'));
  assert.ok(!table.includes('bg-indigo-50/60 pl-3'));
  assert.ok(table.includes('px-4 py-3 ${inGroup ? "border-l-2 border-indigo-100 bg-indigo-50/60"'));
  const desktopGroupRow = table.slice(table.indexOf('<th colSpan={columnCount}'), table.indexOf("{insertAssetButton(section.group.folder)}"));
  const mobileGroupRow = table.slice(table.indexOf("<li\n                {...groupDropProps"), table.indexOf("</li>", table.indexOf("<li\n                {...groupDropProps")));
  assert.ok(desktopGroupRow.indexOf("{groupHeader(section.group)}") < desktopGroupRow.indexOf("<GripIcon"));
  assert.ok(mobileGroupRow.indexOf("{groupHeader(section.group)}") < mobileGroupRow.indexOf("<GripIcon"));
});
