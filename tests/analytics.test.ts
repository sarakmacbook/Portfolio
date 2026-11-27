import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the root layout renders Vercel Web Analytics", () => {
  const layout = read("src/app/layout.tsx");
  assert.ok(
    layout.includes('import { Analytics } from "@vercel/analytics/next"'),
    "the Next.js adapter is imported, not the generic script",
  );
  assert.ok(layout.includes("<Analytics />"), "the element is mounted once, at the end of the body");
  assert.equal(
    layout.split("<Analytics />").length - 1,
    1,
    "one instance is enough — a duplicate would double-count page views",
  );
});

test("the analytics dependency is declared", () => {
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  assert.ok(pkg.dependencies["@vercel/analytics"], "@vercel/analytics is a runtime dependency");
});

test("the README discloses the analytics instead of claiming none", () => {
  const readme = read("README.md");
  assert.ok(!/no analytics/i.test(readme), "the old 'no analytics' claim would now be false");
  assert.ok(readme.includes("## Visitor analytics"), "there is a section describing it");
  assert.ok(/cookieless/i.test(readme), "what it collects is stated plainly");
  assert.ok(
    /no-ops? elsewhere|no-op/.test(readme),
    "self-hosted installs are told the script does nothing there",
  );
  assert.ok(
    readme.includes("npm uninstall @vercel/analytics"),
    "there is a documented way to opt out",
  );
});
