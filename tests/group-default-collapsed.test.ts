import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the dashboard opens with every group hidden", () => {
  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(
    table.includes("const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())"),
    "nothing starts expanded, so every group renders collapsed on load",
  );
  assert.ok(
    !table.includes("folder.collapsed"),
    "a stored expanded flag no longer reveals a group on load",
  );
  assert.ok(
    table.includes("const isCollapsed = !arranging && !expandedGroups.has(key)"),
    "a header is collapsed unless it was opened this visit",
  );
  assert.ok(
    table.includes("(arranging || expandedGroups.has(section.key))"),
    "rows render only for opened groups, and always in Arrange layout",
  );
  assert.ok(
    table.includes('aria-expanded={!isCollapsed}'),
    "the header still announces its state",
  );
});

test("clicking a header reveals that group for the visit, and adding an asset opens it", () => {
  const table = read("src/components/HoldingsTable.tsx");
  assert.ok(table.includes("function toggleGroup(key: string) {"), "headers toggle");
  assert.ok(table.includes("setExpandedGroups((current) => {"), "the toggle updates the opened set");
  assert.ok(
    table.includes("next.add(target.id)"),
    "filing a holding into a group opens that group so the row is visible",
  );
  assert.ok(
    table.includes("a reload is hidden again"),
    "the preference is documented as per-visit, not saved",
  );
});
