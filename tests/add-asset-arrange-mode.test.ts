import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the dashboard's add-asset button only exists in arrange layout", () => {
  const page = read("src/app/page.tsx");
  assert.ok(page.includes("<DashboardArrangeProvider>"), "the dashboard shares the arrange mode with its header");
  assert.ok(page.includes("<AddAssetButton"), "the header uses the arrange-aware add button");
  assert.ok(
    !/<AddAssetDialog[\s\S]{0,200}cashAccounts=\{cashAccounts\}/.test(page),
    "the header no longer renders the add dialog unconditionally",
  );
  // The empty first-run state keeps its own buttons: there is no dashboard to
  // arrange before the very first holding exists.
  assert.ok(page.includes('label="💵 Add cash"'), "the empty state still offers the first holding");
  assert.ok(page.includes('label="🪙 Add crypto"'), "the empty state still offers every asset type");

  const button = read("src/components/AddAssetButton.tsx");
  assert.ok(button.includes("useDashboardArrange()"), "the button reads the arrange mode");
  assert.ok(button.includes("if (!arrange?.arranging) return null;"), "the button renders only while arranging");
  assert.ok(button.includes("<AddAssetDialog"), "the button opens the usual add-holding dialog");

  const context = read("src/components/dashboard-arrange.tsx");
  assert.ok(context.includes("DashboardArrangeProvider"), "the provider is exported");
  assert.ok(context.includes("export function useDashboardArrange"), "the hook is exported");

  const layout = read("src/components/DashboardLayout.tsx");
  assert.ok(layout.includes("useDashboardArrange()"), "the layout drives the shared arrange mode");
  assert.ok(layout.includes("setArranging(true)"), "the layout still enters arrange mode");
  assert.ok(layout.includes("setArranging(false)"), "saving or cancelling leaves arrange mode");
});
