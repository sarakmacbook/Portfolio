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

/* ---------------------------------------------------------------- folder rules */

test("a group is reused by name, but never a holding's own subfolder", () => {
  const reuse = folderForImport([folder("nansen", "Nansen wallet")], "nansen WALLET", { rootOnly: true });
  assert.equal(reuse.folder?.id, "nansen");
  assert.equal(reuse.folders.length, 1);

  const nested = folder("wallet-sub", "Wallet", 7);
  const fresh = folderForImport([nested], "Wallet", { rootOnly: true });
  assert.equal(fresh.folder?.name, "Wallet");
  assert.notEqual(fresh.folder?.id, nested.id, "the holding's subfolder is left alone");
  assert.equal(fresh.folder?.parentAssetId, undefined, "the new group is a root group");
  assert.equal(folderForImport([nested], "Wallet").folder?.id, nested.id, "wallet import behaviour is unchanged");
});

test("a new group takes the uploaded logo; a reused one keeps its own", () => {
  const uploaded = folderForImport([], "Nansen", { icon: "image", imageDataUrl: LOGO });
  assert.equal(uploaded.folder?.icon, "image");
  assert.equal(uploaded.folder?.imageDataUrl, LOGO);

  const emoji = folderForImport([], "Bank", { icon: "emoji", glyph: "🏦" });
  assert.equal(emoji.folder?.glyph, "🏦");
  assert.equal(folderForImport([], "Plain").folder?.icon, "auto", "no logo falls back to the initial");

  const existing: HoldingFolder = { ...folder("nansen", "Nansen"), icon: "emoji", glyph: "🅝" };
  const reused = folderForImport([existing], "Nansen", { rootOnly: true, icon: "image", imageDataUrl: LOGO });
  assert.equal(reused.folder?.icon, "emoji", "the existing group's logo wins");
});

/* ------------------------------------------------------------- shared filing */

test("both flows file holdings the same way", () => {
  const filing = read("src/lib/group-filing.ts");
  assert.ok(filing.includes("folderForImport(folders, request.name"), "one group is created or reused");
  assert.ok(filing.includes("rootOnly: true"), "subfolders are never reused");
  assert.ok(filing.includes("saveHoldingsFolders(result.folders)"), "a brand-new group is stored");
  assert.ok(filing.includes("saveHoldingFolderAssignments(next, result.folders)"), "the chosen holdings are filed");
  assert.ok(filing.includes("groupRoomNote(folders.length)"), "a full group list is reported, not thrown");
  assert.ok(filing.includes("No holdings were ticked"), "an empty selection is handled");
});

/* --------------------------------------------------------------- API imports */

test("the import action ticks rows and files only those", () => {
  const actions = read("src/app/import-actions.ts");
  const body = actions.slice(
    actions.indexOf("export async function importCustomApiHoldingsAction"),
    actions.indexOf("export async function forgetCustomApiImportAction"),
  );
  assert.ok(
    body.includes("rawGroup: CustomApiImportGroupRequest | string | null = null"),
    "the group request is optional, and a bare name still works",
  );
  assert.ok(body.includes("const requestedGroup = normaliseGroupRequest(rawGroup)"), "the request is validated");
  assert.ok(body.includes("let groupNote = \"\";"), "skipping and a full list keep the import successful");
  assert.ok(
    body.includes("inserted.filter((row) => wantedKeys.has(row.key))"),
    "only the ticked holdings are filed",
  );
  assert.ok(body.includes("fileHoldingsIntoGroup(requestedGroup, chosen.map((row) => row.id))"), "the shared helper files them");
  assert.ok(body.includes("left ${leftUngrouped} ungrouped"), "the message counts ungrouped rows");
});

test("the imports page offers the existing root groups to the dialog", () => {
  const page = read("src/app/imports/page.tsx");
  assert.ok(page.includes("loadHoldingsFolders()"));
  assert.ok(page.includes(".filter((folder) => !folder.parentAssetId)"), "subfolders are not offered");
  assert.ok(page.includes("existingGroups={existingGroups}"));
});

/* -------------------------------------------------------------- exchange sync */

test("a sync hands the dialog one row per synced holding", () => {
  const sync = read("src/lib/exchange-sync.ts");
  assert.ok(sync.includes("export async function exchangeGroupCandidates"), "the page can ask for the rows");
  assert.ok(sync.includes("mergeSyncedHoldings(holdings.filter"), "one row per asset, not per exchange");
  assert.ok(sync.includes("export async function syncedAssetIds"), "filing is limited to synced assets");
});

test("sync actions open the dialog after a successful sync", () => {
  const actions = read("src/app/exchange-actions.ts");
  assert.ok(actions.includes("groupCandidates?: GroupPromptRow[]"), "the state carries the rows");
  assert.ok(actions.includes("groupSuggestion?: string"), "and a suggested name");
  assert.ok(
    actions.includes('return { groupCandidates: rows, groupSuggestion: suggestion };'),
    "the rows are returned to the client",
  );
  assert.ok(actions.includes("groupRowsFor([exchange])"), "a single sync offers its own exchange");
  assert.ok(actions.includes("groupRowsFor(synced)"), "Sync all offers every exchange it synced");
  assert.ok(
    actions.includes("async function groupRowsFor") && actions.includes("catch {"),
    "a candidate read that fails cannot turn a finished sync into an error",
  );
});

test("filing after a sync is limited to assets an exchange balance points at", () => {
  const actions = read("src/app/exchange-actions.ts");
  const body = actions.slice(actions.indexOf("export async function fileSyncedHoldingsAction"));
  assert.ok(body.includes("normaliseGroupRequest(rawGroup)"), "the request is validated first");
  assert.ok(body.includes("const available = await syncedAssetIds()"), "only synced assets are candidates");
  assert.ok(body.includes("wanted.has(assetRowKey(id))"), "the ticked rows are matched by asset id");
  assert.ok(body.includes("fileHoldingsIntoGroup(requested, ids)"), "the shared helper files them");
  assert.ok(body.includes("Skipped — the synced holdings stay ungrouped."), "Skip is a no-op, not an error");
  assert.ok(body.includes('revalidatePath("/", "layout")'), "the dashboard refreshes with the new group");
});

test("the exchange page opens the dialog on sync, with the existing groups", () => {
  const component = read("src/components/ExchangeConnect.tsx");
  assert.ok(component.includes("function useGroupOffer"), "the dialog opens once per finished sync");
  assert.ok(component.includes("handled.current = state.ts"), "re-renders never reopen it");
  assert.ok(component.includes("useGroupOffer(state, onOffer)"), "a single exchange's sync offers it");
  assert.ok(component.includes("useGroupOffer(allState, openOffer)"), "Sync all offers it too");
  assert.ok(component.includes("useGroupOffer(state, onOffer ?? NO_OFFER)"), "connecting offers it as well");
  assert.ok(component.includes("<GroupPrompt"), "the shared dialog is mounted");
  assert.ok(component.includes("fileSyncedHoldingsAction(request)"), "the answer is filed server-side");
  assert.ok(component.includes("onSkip={() => setOffer(null)}"), "skipping just closes the dialog");
  assert.ok(component.includes("existingGroups={existingGroups}"));

  const page = read("src/app/exchanges/page.tsx");
  assert.ok(page.includes("loadHoldingsFolders().catch(() => [])"), "a failed group read cannot break the page");
  assert.ok(page.includes("existingGroups={existingGroups}"), "the names reach the dialog");
});

/* ---------------------------------------------------------------- the dialog */

test("the dialog asks for a name, a logo, and lets the user skip", () => {
  const prompt = read("src/components/GroupPrompt.tsx");
  assert.ok(prompt.includes('htmlFor="import-group-name"'), "it asks the user to name the group");
  assert.ok(prompt.includes("maxLength={MAX_FOLDER_NAME_LENGTH}"), "the name is clamped like every other group");
  assert.ok(prompt.includes("Create group & add"), "it creates the group");
  assert.ok(prompt.includes("Skip — leave them ungrouped"), "skipping is always offered");
  assert.ok(prompt.includes("already exists"), "a duplicate name is explained instead of duplicated");
  assert.ok(prompt.includes("readFolderLogo"), "the logo upload reuses the folder-logo pipeline");
  assert.ok(prompt.includes("Upload logo"));
  assert.ok(prompt.includes("Remove"), "an uploaded logo can be taken off again");
  assert.ok(prompt.includes("<FolderIcon"), "the logo is previewed as the group icon");
});

test("the dialog ticks, filters and re-selects the offered holdings", () => {
  const prompt = read("src/components/GroupPrompt.tsx");
  assert.ok(prompt.includes("() => new Set(rows.map((row) => row.key))"), "everything is ticked by default");
  assert.ok(prompt.includes("type=\"checkbox\""), "every holding has a tick box");
  assert.ok(prompt.includes("Select all") && prompt.includes("Clear"), "the list can be selected at once");
  assert.ok(prompt.includes("Filter by symbol, name or source"), "the list can be filtered");
  assert.ok(prompt.includes("row.label.toLowerCase().includes(needle)"), "the filter covers the source label");
  assert.ok(prompt.includes("still kept — they just stay ungrouped"), "unticking does not drop the holding");
  assert.ok(prompt.includes("selectedCount === 0"), "a group cannot be created with nothing ticked");
  assert.ok(prompt.includes("assetKeys: rows.filter"), "the ticked keys are what the action receives");
});

test("the import review step uses the same dialog", () => {
  const component = read("src/components/CustomApiImport.tsx");
  assert.ok(component.includes("<GroupPrompt"), "the shared dialog is mounted, not a copy");
  assert.ok(component.includes("key: importRowKey(row.type, row.symbol)"), "rows carry the action's keys");
  assert.ok(component.includes("suggestedName={preview.sourceName}"), "the connection name is suggested");
  assert.ok(component.includes("setGroupPrompt(true)"), "Import asks before committing");
  assert.ok(component.includes("importSelected(null)"), "Skip imports without a group");
  assert.ok(
    component.includes("importCustomApiHoldingsAction(selectedRows, preview.sourceName, group)"),
    "the answer reaches the server action",
  );
});
