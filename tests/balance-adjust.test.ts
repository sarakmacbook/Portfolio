import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { planBalanceAdjustment } from "../src/lib/balance-adjust";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("cash balance changes become deposit / withdraw entries at $1", () => {
  const increase = planBalanceAdjustment({ type: "cash", current: 120, target: 200, avgCost: 1 });
  assert.deepEqual(increase, {
    ok: true,
    plan: { kind: "deposit", quantity: 80, price: 1, delta: 80 },
  });

  const decrease = planBalanceAdjustment({ type: "cash", current: 120, target: 30, avgCost: 1 });
  assert.deepEqual(decrease, {
    ok: true,
    plan: { kind: "withdraw", quantity: 90, price: 1, delta: -90 },
  });
});

test("asset balance changes are booked at average cost so P/L is not invented", () => {
  const add = planBalanceAdjustment({ type: "crypto", current: 0.5, target: 2, avgCost: 100 });
  assert.deepEqual(add, {
    ok: true,
    plan: { kind: "buy", quantity: 1.5, price: 100, delta: 1.5 },
  });

  const remove = planBalanceAdjustment({ type: "stock", current: 10, target: 4, avgCost: 25.5 });
  assert.deepEqual(remove, {
    ok: true,
    plan: { kind: "sell", quantity: 6, price: 25.5, delta: -6 },
  });

  const noCostBasis = planBalanceAdjustment({ type: "other", current: 0, target: 3, avgCost: 0 });
  assert.equal(noCostBasis.ok, true);
  if (noCostBasis.ok) assert.equal(noCostBasis.plan.price, 0);
});

test("invalid and unchanged balances are rejected before writing anything", () => {
  assert.deepEqual(planBalanceAdjustment({ type: "cash", current: 10, target: -1 }), {
    ok: false,
    error: "Enter a balance of zero or more.",
  });
  assert.deepEqual(planBalanceAdjustment({ type: "cash", current: 10, target: Number.NaN }), {
    ok: false,
    error: "Enter a balance of zero or more.",
  });
  assert.deepEqual(planBalanceAdjustment({ type: "cash", current: 10, target: 10 }), {
    ok: false,
    error: "The balance is already that amount.",
  });
  assert.deepEqual(planBalanceAdjustment({ type: "crypto", current: Number.NaN, target: 10 }), {
    ok: false,
    error: "The current balance is unavailable.",
  });
});

test("every holding surface offers the balance control, backed by a real ledger action", () => {
  const actions = read("src/app/actions.ts");
  const adjust = actions.slice(
    actions.indexOf("export async function adjustBalance"),
    actions.indexOf("export async function deleteTransaction"),
  );
  assert.ok(adjust.includes("planBalanceAdjustment("), "the target is turned into a correction plan");
  assert.ok(adjust.includes("validateWithNewTx("), "the correction is checked against the whole history");
  assert.ok(adjust.includes("db.insert(transactions)"), "the correction is stored as a transaction");
  assert.ok(adjust.includes("recomputeAsset(id)"), "the holding balance is replayed afterwards");

  const table = read("src/components/HoldingsTable.tsx");
  assert.equal(table.match(/<BalanceAdjustButton/g)?.length, 2, "desktop rows and phone cards both offer it");

  const assetPage = read("src/app/assets/[id]/page.tsx");
  assert.ok(assetPage.includes("<BalanceAdjustButton"), "the holding page offers it too");

  const control = read("src/components/BalanceAdjustButton.tsx");
  assert.ok(control.includes('min-h-11'), "phone buttons are at least 44 px tall");
  assert.ok(control.includes('type="number"'), "the new balance is a numeric field");
  assert.ok(control.includes("inputMode=\"decimal\""), "phones get the decimal keyboard");
  assert.ok(control.includes("name=\"date\""), "the correction is dated");
});
