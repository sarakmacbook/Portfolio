import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  UNGROUPED_SECTION_KEY,
  assetIdFromSectionKey,
  assetSectionKey,
  isAssetSectionKey,
} from "../src/lib/holdings-folders";
import {
  collapseHoldingsSections,
  expandHoldingsSections,
  normaliseHoldingsSections,
  reorderHoldingsAssetSections,
} from "../src/lib/holdings-sections";
import { moveKeyTo } from "../src/lib/order-list";

test("asset section keys are distinct from folder ids and strictly validated", () => {
  const key = assetSectionKey(42);
  assert.equal(key, "$asset:42");
  assert.equal(assetIdFromSectionKey(key), 42);
  assert.equal(isAssetSectionKey(key), true);
  assert.equal(assetIdFromSectionKey("folder"), null);
  assert.equal(assetIdFromSectionKey("$asset:0"), null);
  assert.equal(assetIdFromSectionKey("$asset:-2"), null);
  assert.equal(assetIdFromSectionKey("$asset:nope"), null);
});

test("legacy ungrouped blocks expand in place without dropping new folders", () => {
  const assets = [assetSectionKey(10), assetSectionKey(11)];
  assert.deepEqual(
    normaliseHoldingsSections([UNGROUPED_SECTION_KEY, "a"], ["a", "b"], [10, 11]),
    [...assets, "a", "b"],
  );
  assert.deepEqual(
    normaliseHoldingsSections(["a", UNGROUPED_SECTION_KEY], ["a", "b"], [10, 11]),
    ["a", ...assets, "b"],
  );
});

test("a group keeps its precise place directly below one named asset", () => {
  const kbPrasac = assetSectionKey(42);
  const otherAsset = assetSectionKey(7);
  const before = normaliseHoldingsSections(
    ["asdade", kbPrasac, otherAsset],
    ["asdade"],
    [7, 42],
  );
  const detailed = moveKeyTo(before, "asdade", kbPrasac, true);

  assert.deepEqual(detailed, [kbPrasac, "asdade", otherAsset]);
  assert.equal(detailed.indexOf("asdade"), detailed.indexOf(kbPrasac) + 1);

  const withNewAsset = normaliseHoldingsSections(detailed, ["asdade"], [7, 42, 99]);
  assert.deepEqual(withNewAsset, [kbPrasac, "asdade", otherAsset, assetSectionKey(99)]);
});

test("coarse arrange pills can move the whole ungrouped block", () => {
  const detailed = [assetSectionKey(1), "a", assetSectionKey(2), "b"];
  const blocks = collapseHoldingsSections(detailed);
  assert.deepEqual(blocks, [UNGROUPED_SECTION_KEY, "a", "b"]);
  assert.deepEqual(
    expandHoldingsSections(["a", UNGROUPED_SECTION_KEY, "b"], detailed),
    ["a", assetSectionKey(1), assetSectionKey(2), "b"],
  );
});

test("individual holding arrangement retains group slots and every asset", () => {
  const one = assetSectionKey(1);
  const two = assetSectionKey(2);
  const three = assetSectionKey(3);
  assert.deepEqual(
    reorderHoldingsAssetSections([one, "a", two, three], [3, 1, 2]),
    [three, "a", one, two],
  );
});

test("the table renders precise asset targets and both save paths retain them", () => {
  const rootDir = resolve(__dirname, "..");
  const read = (file: string) => readFileSync(join(rootDir, file), "utf8");
  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(table.includes("normaliseHoldingsSections("));
  assert.ok(table.includes("renderDesktopRow(section.row"));
  assert.ok(table.includes("renderMobileCard(section.row"));
  assert.ok(table.includes("moveKeyTo(sectionKeys, key, adjacent.key, true)"));

  for (const file of ["src/app/actions.ts", "src/lib/dashboard-layout-save.ts"]) {
    const source = read(file);
    assert.ok(
      source.includes("known.has(key) || isAssetSectionKey(key)"),
      `${file} keeps detailed asset keys when saving`,
    );
  }
});

test("new groups start above existing groups and assets; existing order stays intact", async () => {
  const { syncSectionsWithFolders } = await import("../src/lib/holdings-sections");
  const folder = (id: string, parentAssetId?: number) => ({ id, name: id, color: "#6366f1", icon: "auto" as const, glyph: "", collapsed: false, parentAssetId });
  const existing = [assetSectionKey(1), "old", assetSectionKey(2)];
  assert.deepEqual(syncSectionsWithFolders(existing, [folder("new"), folder("old")]), ["new", ...existing]);
  assert.deepEqual(syncSectionsWithFolders([], [folder("new")]), ["new", UNGROUPED_SECTION_KEY]);
  assert.deepEqual(syncSectionsWithFolders(existing, [folder("old"), folder("nested", 1)]), existing);
  assert.deepEqual(syncSectionsWithFolders(["new", ...existing], [folder("old"), folder("new")]), ["new", ...existing]);
});

test("all creation paths persist new root groups at the top", () => {
  const db = readFileSync(resolve(__dirname, "../src/lib/dashboard-order-db.ts"), "utf8");
  assert.ok(db.includes("const created = normalised.filter((folder) => !existingIds.has(folder.id))"));
  assert.ok(db.includes("created.filter((folder) => !folder.parentAssetId)"));
  assert.ok(db.includes("await saveHoldingsSections([\n      ...rootIds,"));
  const strip = readFileSync(resolve(__dirname, "../src/components/HoldingsFolders.tsx"), "utf8");
  assert.ok(strip.includes("onFoldersChange([result.folder, ...folders])"));
});

test("Save layout's JSON section payload round-trips without clearing the order", async () => {
  const { parseHoldingsSections } = await import("../src/lib/dashboard-order-db");
  const sections = ["bank", assetSectionKey(1), assetSectionKey(2), "exchange"];

  // The Save layout form sends JSON.stringify(sections); every key must
  // survive parsing exactly, or the known-key filter clears the saved order
  // and a group dragged to the top snaps back after the next page load.
  assert.deepEqual(parseHoldingsSections(JSON.stringify(sections)), sections);

  // The stored format (comma-joined) and plain arrays keep working.
  assert.deepEqual(parseHoldingsSections(sections.join(",")), sections);
  assert.deepEqual(parseHoldingsSections(sections), sections);

  // Blanks and repeats are still dropped, and junk never throws.
  assert.deepEqual(parseHoldingsSections('["bank","","bank"]'), ["bank"]);
  assert.deepEqual(parseHoldingsSections("bank,,bank"), ["bank"]);
  assert.deepEqual(parseHoldingsSections("[not json"), []);
  assert.deepEqual(parseHoldingsSections('{"bank":1}'), []);
  assert.deepEqual(parseHoldingsSections(42), []);
});
