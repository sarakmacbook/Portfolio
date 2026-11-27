import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import manifest from "../src/app/manifest";
import { isActivePath, isImportPath, isSettingsPath } from "../src/lib/nav-links";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

test("mobile navigation respects privacy and has room for safe areas and dialogs", () => {
  const nav = read("src/components/MobileTabBar.tsx");
  const css = read("src/app/globals.css");
  const layout = read("src/app/layout.tsx");
  assert.ok(nav.includes("if (locked) return null"));
  assert.ok(nav.includes('aria-label="Quick navigation"'));
  assert.ok(layout.includes("<MobileTabBar />"));
  assert.match(css, /\.mobile-tab-bar\s*\{[^}]*z-index:\s*30/);
  assert.match(css, /\.mobile-tab-bar\s*\{[^}]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.app-footer\s*\{\s*padding-bottom: calc\(6rem \+ env\(safe-area-inset-bottom\)\)/);
  assert.ok(isActivePath("/assets/1", "/"));
  assert.ok(isImportPath("/imports"));
  assert.ok(isSettingsPath("/alerts"));
});

test("mobile history can be scrubbed without blocking vertical scrolling", () => {
  const history = read("src/components/Charts.tsx").split("export function PriceHistoryChart")[0];
  assert.ok(history.includes("touch-pan-y"));
  assert.ok(history.includes("onTouchStart"));
  assert.ok(history.includes("onTouchMove"));
  assert.ok(history.includes("onTouchCancel"));
});

test("install manifest includes Android-sized icons and usable shortcuts", () => {
  const value = manifest();
  assert.ok(value.icons?.some((icon) => icon.sizes === "192x192" && icon.src === "/icon-192.png"));
  assert.ok(value.icons?.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
  for (const shortcut of value.shortcuts ?? []) {
    assert.ok(shortcut.url.startsWith("/"));
  }
  assert.ok((value.shortcuts?.length ?? 0) > 0);
});
