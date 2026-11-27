import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { folderForImport, type HoldingFolder } from "../src/lib/holdings-folders";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Smallest inline JPEG the folder-logo validator accepts. */
const LOGO = "data:image/jpeg;base64,/9j/2wAA/9k=";

function folder(id: string, name: string, parentAssetId?: number): HoldingFolder {
  return {
    id,
    name,
    color: "#6366f1",
    icon: "auto",
    glyph: "",
    collapsed: false,
    ...(parentAssetId ? { parentAssetId } : {}),
  };
}

test("a bulk import reuses a root group by name", () => {
  const result = folderForImport([folder("nansen", "Nansen wallet")], "nansen WALLET", { rootOnly: true });
  assert.equal(result.folder?.id, "nansen", "the name match is case-insensitive");
  assert.equal(result.folders.length, 1, "no duplicate group is created");
});

test("a bulk import ignores subfolders that share its name", () => {
  const nested = folder("wallet-sub", "Wallet", 7);
  const result = folderForImport([nested], "Wallet", { rootOnly: true });
  assert.ok(result.folder, "a portfolio-level group is still created");
  assert.equal(result.folder?.name, "Wallet");
  assert.notEqual(result.folder?.id, nested.id, "the holding's own subfolder is left alone");
  assert.equal(result.folder?.parentAssetId, undefined, "the new group is a root group");
  assert.deepEqual(result.folders.map((item) => item.id), ["wallet-sub", result.folder!.id]);
});

test("without rootOnly a matching subfolder is still reused (wallet import behaviour)", () => {
  const nested = folder("wallet-sub", "Wallet", 7);
  assert.equal(folderForImport([nested], "Wallet").folder?.id, nested.id);
});

test("a new import group takes the uploaded logo or emoji", () => {
  const uploaded = folderForImport([], "Nansen", { icon: "image", imageDataUrl: LOGO });
  assert.equal(uploaded.folder?.icon, "image", "the uploaded logo is stored on the new group");
  assert.equal(uploaded.folder?.imageDataUrl, LOGO);
  assert.equal(uploaded.folder?.glyph, "");

  const emoji = folderForImport([], "Bank", { icon: "emoji", glyph: "🏦" });
  assert.equal(emoji.folder?.icon, "emoji");
  assert.equal(emoji.folder?.glyph, "🏦");

  assert.equal(folderForImport([], "Plain").folder?.icon, "auto", "no logo falls back to the initial");
});

test("a reused group keeps its own logo instead of the newly uploaded one", () => {
  const existing: HoldingFolder = {
    ...folder("nansen", "Nansen"),
    icon: "emoji",
    glyph: "🅝",
  };
  const result = folderForImport([existing], "Nansen", { rootOnly: true, icon: "image", imageDataUrl: LOGO });
  assert.equal(result.folder?.id, "nansen");
  assert.equal(result.folder?.icon, "emoji", "the existing group's icon wins");
  assert.equal(result.folder?.glyph, "🅝");
  assert.equal(result.folders.length, 1);
});

test("the import action accepts a group request, a bare name, or a Skip", () => {
  const actions = read("src/app/import-actions.ts");
  const body = actions.slice(
    actions.indexOf("export async function importCustomApiHoldingsAction"),
    actions.indexOf("export async function forgetCustomApiImportAction"),
  );
  assert.ok(
    body.includes("rawGroup: CustomApiImportGroupRequest | string | null = null"),
    "the group request is optional, and an older tab's bare name still works",
  );
  assert.ok(body.includes("const requestedGroup = normaliseGroupRequest(rawGroup)"), "the request is validated server-side");
  assert.ok(body.includes("if (requestedGroup && inserted.length > 0)"), "skipping still imports the rows");
  assert.ok(
    body.includes("inserted.filter((row) => wantedKeys.has(row.key))"),
    "only the ticked holdings are filed into the group",
  );
  assert.ok(body.includes("created.push({ id: asset.id, key })"), "each imported row keeps its type:symbol key");
  assert.ok(
    body.includes("folderForImport(folders, requestedGroup.name, {"),
    "a root group is created or reused",
  );
  assert.ok(body.includes("rootOnly: true"), "subfolders are never reused for a bulk import");
  assert.ok(body.includes("...(requestedGroup.icon ?? {})"), "the uploaded logo reaches the new group");
  assert.ok(body.includes("for (const row of chosen) next[row.id] = result.folder.id"), "the ticked rows are filed");
  assert.ok(body.includes("left ${leftUngrouped} ungrouped"), "the result reports rows left ungrouped");
  assert.ok(body.includes("Imported without a group"), "a full group list falls back to importing ungrouped");
});

test("the group request is validated before it can create a group", () => {
  const actions = read("src/app/import-actions.ts");
  const body = actions.slice(
    actions.indexOf("function normaliseGroupRequest"),
    actions.indexOf("export async function importCustomApiHoldingsAction"),
  );
  assert.ok(body.includes("if (!name) return null;"), "a blank name means no group");
  assert.ok(body.includes("if (assetKeys.size === 0) return null;"), "an empty tick list means no group");
  assert.ok(body.includes("MAX_CUSTOM_IMPORT_ROWS"), "the ticked keys are capped");
  assert.ok(body.includes("/^[A-Z0-9][A-Z0-9._-]{0,31}$/"), "untrusted keys are shape-checked");
  assert.ok(body.includes(".slice(0, MAX_FOLDER_NAME_LENGTH)"), "the name is clamped like every group");
});

test("the imports page offers the existing root groups to the prompt", () => {
  const page = read("src/app/imports/page.tsx");
  assert.ok(page.includes("loadHoldingsFolders()"), "the page reads the groups");
  assert.ok(page.includes(".filter((folder) => !folder.parentAssetId)"), "subfolders are not offered");
  assert.ok(page.includes("existingGroups={existingGroups}"), "they are handed to the client component");
});

test("the group prompt names the group, takes a logo, and can be skipped", () => {
  const prompt = read("src/components/ImportGroupPrompt.tsx");
  assert.ok(prompt.includes('htmlFor="import-group-name"'), "the dialog asks the user to name the group");
  assert.ok(prompt.includes("maxLength={MAX_FOLDER_NAME_LENGTH}"), "the name is clamped like every other group");
  assert.ok(prompt.includes("Create group & import"), "it creates the group");
  assert.ok(prompt.includes("Skip — import without a group"), "skipping is always offered");
  assert.ok(prompt.includes("onSkip"), "the skip button is wired to the parent");
  assert.ok(prompt.includes("already exists"), "a duplicate name is explained instead of silently duplicated");
  assert.ok(prompt.includes("readFolderLogo"), "the logo upload reuses the folder-logo pipeline");
  assert.ok(prompt.includes("Upload logo"), "the user can upload a logo");
  assert.ok(prompt.includes("Remove"), "an uploaded logo can be taken off again");
  assert.ok(prompt.includes("<FolderIcon"), "the chosen logo is previewed as the group icon");
});

test("the prompt ticks, filters and re-selects the imported holdings", () => {
  const prompt = read("src/components/ImportGroupPrompt.tsx");
  assert.ok(prompt.includes("type=\"checkbox\""), "every holding has a tick box");
  assert.ok(prompt.includes("() => new Set(rows.map((row) => rowKey(row)))"), "everything is ticked by default");
  assert.ok(prompt.includes("Select all"), "the whole list can be selected at once");
  assert.ok(prompt.includes("Clear"), "and cleared again");
  assert.ok(prompt.includes("Filter by symbol, name or type"), "the list can be filtered");
  assert.ok(prompt.includes("row.symbol.toLowerCase().includes(needle)"), "the filter matches symbol, name and type");
  assert.ok(prompt.includes("Unticked holdings still import"), "unticking is not a silent deletion");
  assert.ok(prompt.includes("selectedCount === 0"), "a group cannot be created with nothing ticked");
  assert.ok(prompt.includes("assetKeys: rows.filter"), "the ticked keys are what the action receives");
});

test("the review step opens the prompt and imports only after the choice", () => {
  const component = read("src/components/CustomApiImport.tsx");
  assert.ok(component.includes("setGroupPrompt(true)"), "the Import button asks for a group first");
  assert.ok(component.includes("<ImportGroupPrompt"), "the prompt is mounted from the review section");
  assert.ok(component.includes("rows={selectedRows}"), "the prompt works on the rows being imported");
  assert.ok(component.includes("importSelected(null)"), "Skip imports without a group");
  assert.ok(
    component.includes("importCustomApiHoldingsAction(selectedRows, preview.sourceName, group)"),
    "the group request reaches the server action",
  );
  assert.ok(component.includes("onConfirm={(group) => void importSelected(group)}"), "the request is submitted");
});
