import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { folderForImport, type HoldingFolder } from "../src/lib/holdings-folders";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

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

test("the import action asks for a group, files the new holdings, and accepts Skip", () => {
  const actions = read("src/app/import-actions.ts");
  const body = actions.slice(
    actions.indexOf("export async function importCustomApiHoldingsAction"),
    actions.indexOf("export async function forgetCustomApiImportAction"),
  );
  assert.ok(
    body.includes("rawGroupName: string | null = null"),
    "the group name is optional so skipping never fails the import",
  );
  assert.ok(body.includes("folderForImport(folders, groupName, { rootOnly: true })"), "a root group is created or reused");
  assert.ok(body.includes("saveHoldingsFolders(result.folders)"), "a brand-new group is stored");
  assert.ok(body.includes("saveHoldingFolderAssignments(next, result.folders)"), "the imported rows are filed into it");
  assert.ok(body.includes("for (const id of inserted) next[id] = result.folder.id"), "every imported holding is filed");
  assert.ok(body.includes("Imported without a group"), "a full group list falls back to importing ungrouped");
  assert.ok(body.includes("into the “${group.name}” group"), "the result reports the group it used");
});

test("the imports page offers the existing root groups to the prompt", () => {
  const page = read("src/app/imports/page.tsx");
  assert.ok(page.includes("loadHoldingsFolders()"), "the page reads the groups");
  assert.ok(page.includes(".filter((folder) => !folder.parentAssetId)"), "subfolders are not offered");
  assert.ok(page.includes("existingGroups={existingGroups}"), "they are handed to the client component");
});

test("the group prompt names, creates, and can be skipped", () => {
  const prompt = read("src/components/ImportGroupPrompt.tsx");
  assert.ok(prompt.includes('htmlFor="import-group-name"'), "the dialog asks the user to name the group");
  assert.ok(prompt.includes("maxLength={MAX_FOLDER_NAME_LENGTH}"), "the name is clamped like every other group");
  assert.ok(prompt.includes("Create group &amp; import") || prompt.includes("Create group & import"), "it creates the group");
  assert.ok(prompt.includes("Skip — import without a group"), "skipping is always offered");
  assert.ok(prompt.includes("onSkip"), "the skip button is wired to the parent");
  assert.ok(prompt.includes("already exists"), "a duplicate name is explained instead of silently duplicated");
});

test("the review step opens the prompt and imports only after the choice", () => {
  const component = read("src/components/CustomApiImport.tsx");
  assert.ok(component.includes("setGroupPrompt(true)"), "the Import button asks for a group first");
  assert.ok(component.includes("<ImportGroupPrompt"), "the prompt is mounted from the review section");
  assert.ok(component.includes("importSelected(null)"), "Skip imports without a group");
  assert.ok(
    component.includes("importCustomApiHoldingsAction(selectedRows, preview.sourceName, groupName)"),
    "the typed name reaches the server action",
  );
  assert.ok(component.includes("onConfirm={(name) => void importSelected(name)}"), "the typed name is submitted");
});
