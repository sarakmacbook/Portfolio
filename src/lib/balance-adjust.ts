import type { AssetType } from "./constants";

/**
 * Balances are not stored by hand: they are replayed from transactions. A
 * balance adjustment therefore writes one small correction transaction instead
 * of overwriting `assets.quantity`, which would be undone by the next replay.
 *
 * The correction is priced at the asset's average cost (1 for cash), so it
 * changes the quantity without inventing a gain, a loss, or a new cost basis.
 */
export type BalanceAdjustmentPlan = {
  kind: "deposit" | "withdraw" | "buy" | "sell";
  quantity: number;
  price: number;
  delta: number;
};

export type BalanceAdjustmentResult =
  | { ok: true; plan: BalanceAdjustmentPlan }
  | { ok: false; error: string };

const EPSILON = 1e-9;

export function planBalanceAdjustment(input: {
  type: AssetType;
  current: number;
  target: number;
  avgCost?: number;
}): BalanceAdjustmentResult {
  const { type, current, target } = input;
  if (!Number.isFinite(current) || current < 0) {
    return { ok: false, error: "The current balance is unavailable." };
  }
  if (!Number.isFinite(target) || target < 0) {
    return { ok: false, error: "Enter a balance of zero or more." };
  }

  const delta = target - current;
  if (Math.abs(delta) < EPSILON) {
    return { ok: false, error: "The balance is already that amount." };
  }

  const isCash = type === "cash";
  const avgCost = Number.isFinite(input.avgCost) ? Math.max(0, input.avgCost ?? 0) : 0;
  return {
    ok: true,
    plan: {
      kind: isCash
        ? delta > 0
          ? "deposit"
          : "withdraw"
        : delta > 0
          ? "buy"
          : "sell",
      quantity: Math.abs(delta),
      price: isCash ? 1 : avgCost,
      delta,
    },
  };
}
