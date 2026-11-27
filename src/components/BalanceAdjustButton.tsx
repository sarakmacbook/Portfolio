"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { adjustBalance, type ActionState } from "@/app/actions";
import type { AssetType } from "@/lib/constants";
import { money, qty } from "@/lib/format";
import { ErrorNote, Modal, SubmitButton } from "./ui";

export type BalanceAsset = {
  id: number;
  name: string;
  symbol: string;
  type: AssetType;
  /** Balance the ledger currently holds (quantity for assets, dollars for cash). */
  quantity: number;
  avgCost: number;
};

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function balanceLabel(asset: BalanceAsset, value: number) {
  if (asset.type === "cash") return money(value);
  return `${qty(value)} ${asset.symbol || "units"}`;
}

/**
 * One button per holding, used by the desktop table, the phone cards and the
 * holding page. The phone layout gets a full-width 44 px row; the table uses a
 * compact icon so it fits beside the asset name.
 */
export default function BalanceAdjustButton({
  asset,
  compact = false,
  className = "",
}: {
  asset: BalanceAsset;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
            : `btn-ghost min-h-11 ${className}`
        }
        aria-label={compact ? `Adjust balance for ${asset.name}` : undefined}
        title={compact ? "Adjust balance" : undefined}
      >
        {compact ? <span aria-hidden="true">✎</span> : "Adjust balance"}
      </button>
      <Modal open={open} onClose={close} title={`Adjust ${asset.name} balance`}>
        {open && <BalanceAdjustForm asset={asset} onDone={close} />}
      </Modal>
    </>
  );
}

function BalanceAdjustForm({ asset, onDone }: { asset: BalanceAsset; onDone: () => void }) {
  const router = useRouter();
  const fieldId = useId();
  const [state, action] = useActionState<ActionState, FormData>(adjustBalance, {});
  const [balance, setBalance] = useState(() => String(Number(asset.quantity.toFixed(8))));
  const target = Number(balance.replace(/,/g, ""));
  const delta = Number.isFinite(target) ? target - asset.quantity : 0;

  useEffect(() => {
    if (state.ok && state.ts) {
      onDone();
      router.refresh();
    }
  }, [state.ok, state.ts, onDone, router]);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={asset.id} />
      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <span className="text-slate-500">Current balance</span>
        <span className="font-semibold tabular-nums text-slate-900">{balanceLabel(asset, asset.quantity)}</span>
      </div>
      <div>
        <label className="label" htmlFor={fieldId}>
          New balance {asset.type !== "cash" && asset.symbol ? `(${asset.symbol})` : ""}
        </label>
        <input
          id={fieldId}
          name="balance"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className="input tabular-nums"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          autoFocus
          required
        />
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {delta > 1e-9
          ? `Add ${balanceLabel(asset, Math.abs(delta))}`
          : delta < -1e-9
            ? `Remove ${balanceLabel(asset, Math.abs(delta))}`
            : "Enter a different balance to record the change."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`${fieldId}-date`}>
            Date
          </label>
          <input id={`${fieldId}-date`} name="date" type="date" className="input" defaultValue={todayStr()} />
        </div>
        <div>
          <label className="label" htmlFor={`${fieldId}-note`}>
            Note <span className="normal-case tracking-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={`${fieldId}-note`}
            name="note"
            className="input"
            placeholder="e.g. corrected exchange balance"
            maxLength={200}
          />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        A correction is added to this holding&apos;s transaction history, so its cost basis and P/L stay accurate.
      </p>
      <ErrorNote error={state.error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} className="btn-ghost min-h-11 w-full sm:w-auto">
          Cancel
        </button>
        <SubmitButton className="btn-primary min-h-11 w-full sm:w-auto" pendingText="Saving…">
          Save balance
        </SubmitButton>
      </div>
    </form>
  );
}
