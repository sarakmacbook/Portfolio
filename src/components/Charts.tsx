"use client";

import { useId, useMemo, useState } from "react";
import { fmtDate, money, pct, pnlColor } from "@/lib/format";
import {
  PRICE_HISTORY_RANGES,
  filterPricePointsByRange,
  type PriceHistoryRange,
  type PricePoint,
} from "@/lib/price-history";

export type Slice = { label: string; value: number; color: string };

export function Donut({ slices, centerLabel }: { slices: Slice[]; centerLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const largestIndex = slices.reduce((best, slice, i) => slice.value > (slices[best]?.value ?? 0) ? i : best, 0);
  const active = slices[hover ?? largestIndex];

  return (
    <div className="allocation-chart w-full min-w-0">
      <div className="allocation-content flex min-w-0 flex-col items-center">
        <div className="allocation-ring relative shrink-0">
          <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" role="img" aria-label={`Portfolio allocation: ${slices.map(s => `${s.label} ${money(s.value)}`).join(", ") || "No holdings"}`}>
            {total === 0 && <circle className="donut-track" cx="90" cy="90" r={r} fill="none" strokeWidth="16" />}
            {total > 0 && slices.map((slice, i) => {
              const len = Math.max(0, slice.value) / total * c;
              const gap = Math.min(24, len * .35);
              const start = offset;
              offset += len;
              if (len === 0) return null;
              return <circle key={slice.label} cx="90" cy="90" r={r} fill="none"
                stroke={slice.color} strokeWidth={hover === i ? 19 : 16}
                strokeLinecap="round" strokeDasharray={`${Math.max(.01, len - gap)} ${c - Math.max(.01, len - gap)}`}
                strokeDashoffset={-start - gap / 2}
                className="transition-all duration-200"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
            <span className="allocation-value text-3xl text-slate-900">{total > 0 && active ? `${(Math.max(0, active.value) / total * 100).toFixed(1)}%` : "0%"}</span>
            <span className="max-w-[65%] text-sm text-slate-600">{active?.label ?? centerLabel}</span>
          </div>
        </div>
        <ul className="allocation-legend min-w-0 w-full">
          {slices.map((slice, i) => <li key={slice.label}>
            <button type="button" className={`flex items-center justify-between gap-2 text-left transition ${hover === i ? "bg-slate-50" : ""}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
              aria-label={`${slice.label}: ${money(slice.value)}, ${total > 0 ? (Math.max(0, slice.value) / total * 100).toFixed(1) : 0} percent`}>
              <span className="flex min-w-0 items-center gap-3"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: slice.color }} /><span className="truncate text-slate-700">{slice.label}</span></span>
              <span className="allocation-value shrink-0 text-slate-900">{money(slice.value)}</span>
            </button>
          </li>)}
          {slices.length === 0 && <li className="text-center text-sm text-slate-400">No holdings yet</li>}
        </ul>
      </div>
    </div>
  );
}

const W = 640;
const H = 220;
const P = { t: 16, r: 12, b: 24, l: 12 };

export type Point = { date: string; value: number; cost: number };

type HistoryRange = "1M" | "6M" | "1Y" | "ALL";
const HISTORY_RANGES: Array<{ value: HistoryRange; label: string; months?: number }> = [
  { value: "1M", label: "1 month", months: 1 },
  { value: "6M", label: "6 months", months: 6 },
  { value: "1Y", label: "1 year", months: 12 },
  { value: "ALL", label: "All time" },
];

export function HistoryChart({ points }: { points: Point[] }) {
  const gradId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<HistoryRange>("6M");
  const [view, setView] = useState<"bars" | "line">("bars");

  const visiblePoints = useMemo(() => {
    const selected = HISTORY_RANGES.find((item) => item.value === range);
    if (!selected?.months || points.length === 0) return points;
    const latest = new Date(`${points[points.length - 1].date}T00:00:00Z`);
    const cutoff = new Date(latest);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - selected.months);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const filtered = points.filter((point) => point.date >= cutoffDate);
    return filtered.length > 0 ? filtered : [points[points.length - 1]];
  }, [points, range]);

  const lifetime = useMemo(() => {
    if (!points.length) return null;
    let high = points[0];
    let low = points[0];
    for (const point of points.slice(1)) {
      if (point.value > high.value) high = point;
      if (point.value < low.value) low = point;
    }
    return { high, low };
  }, [points]);

  const { path, area, costPath, xs, ys, min, max } = useMemo(() => {
    const vals = visiblePoints.flatMap((p) => [p.value, p.cost]);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (!isFinite(min)) {
      min = 0;
      max = 1;
    }
    if (max - min < 1e-6) {
      min = min * 0.9;
      max = max * 1.1 || 1;
    }
    if (view === "bars") min = Math.min(0, min);
    const pad = (max - min) * 0.1;
    if (view !== "bars") min -= pad;
    max += pad;
    const n = visiblePoints.length;
    const xs = visiblePoints.map((_, i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r)));
    const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
    const ys = visiblePoints.map((p) => y(p.value));
    const cys = visiblePoints.map((p) => y(p.cost));
    const line = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${v.toFixed(1)}`).join(" ");
    const path = line(ys);
    const area = n ? `${path} L${xs[n - 1]},${H - P.b} L${xs[0]},${H - P.b} Z` : "";
    return { path, area, costPath: line(cys), xs, ys, min, max };
  }, [visiblePoints, view]);

  if (points.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center text-sm text-slate-400">
        History appears once you add holdings — a snapshot is saved daily whenever values change.
      </div>
    );
  }

  const up = visiblePoints[visiblePoints.length - 1].value >= visiblePoints[0].value;
  const stroke = up ? "#9ed5ff" : "#fb8395";
  const h = hover !== null ? visiblePoints[hover] : visiblePoints[visiblePoints.length - 1];

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="History period">
        {HISTORY_RANGES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setRange(item.value);
              setHover(null);
            }}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
              range === item.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
            aria-pressed={range === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex justify-end gap-2" aria-label="Chart style">
        {(["bars", "line"] as const).map(style => <button key={style} type="button" aria-pressed={view === style} onClick={() => setView(style)} className={`rounded-full px-3 py-1 text-xs ${view === style ? "bg-slate-900 text-white" : "text-slate-500"}`}>{style === "bars" ? "Bars" : "Line"}</button>)}
      </div>
      {lifetime && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">All-time high</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(lifetime.high.value)}</div>
            <div className="text-xs text-slate-500">{fmtDate(lifetime.high.date)}</div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">All-time low</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(lifetime.low.value)}</div>
            <div className="text-xs text-slate-500">{fmtDate(lifetime.low.date)}</div>
          </div>
        </div>
      )}
      <div className="mb-2 flex flex-col gap-1 text-sm sm:flex-row sm:items-baseline sm:justify-between">
        <span className="text-slate-500">{fmtDate(h.date)}</span>
        <span className="flex gap-4">
          <span>
            <span className="text-slate-400">Value </span>
            <span className="font-semibold text-slate-900">{money(h.value)}</span>
          </span>
          <span>
            <span className="text-slate-400">Cost </span>
            <span className="font-medium text-slate-600">{money(h.cost)}</span>
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Portfolio value history; dashed line represents cost basis"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          xs.forEach((v, i) => {
            if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
          });
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id={`hist-fill-${gradId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line className="history-grid-line" key={f} x1={P.l} x2={W - P.r} y1={P.t + f * (H - P.t - P.b)} y2={P.t + f * (H - P.t - P.b)} />
        ))}
        {view === "line" && <path d={area} fill={`url(#hist-fill-${gradId})`} />}
        {view === "bars" && visiblePoints.map((point, i) => {
          const width = Math.min(28, (W - P.l - P.r) / visiblePoints.length * .65);
          const bottom = H - P.b;
          const top = ys[i];
          const left = Math.min(W - P.r - width, Math.max(P.l, xs[i] - width / 2));
          const radius = Math.min(width / 2, (bottom - top) / 2);
          return <path key={point.date} d={`M${left},${bottom} V${top + radius} Q${left},${top} ${left + radius},${top} H${left + width - radius} Q${left + width},${top} ${left + width},${top + radius} V${bottom} Z`} fill={i === visiblePoints.length - 1 ? "#49e18b" : "#9ed5ff"} opacity={hover === null || hover === i ? 1 : .5}><title>{fmtDate(point.date)}: {money(point.value)}</title></path>;
        })}
        <path d={costPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {view === "line" && <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {visiblePoints.length === 1 && <circle cx={xs[0]} cy={ys[0]} r="4" fill={stroke} />}
        {hover !== null && (
          <>
            <line className="history-hover-line" x1={xs[hover]} x2={xs[hover]} y1={P.t} y2={H - P.b} vectorEffect="non-scaling-stroke" />
            <circle className="history-hover-dot" cx={xs[hover]} cy={ys[hover]} r="4" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
        <text x={P.l} y={H - 6} fontSize="11" fill="#94a3b8">
          {fmtDate(visiblePoints[0].date)}
        </text>
        <text x={W - P.r} y={H - 6} fontSize="11" fill="#94a3b8" textAnchor="end">
          {fmtDate(visiblePoints[visiblePoints.length - 1].date)}
        </text>
      </svg>
      {view === "bars" && <p className="mt-2 text-xs text-slate-500">Blue: portfolio value · Mint: latest snapshot · Dashed: cost basis</p>}
      <span className="sr-only">
        Range {money(min)} to {money(max)}
      </span>
    </div>
  );
}

export function PriceHistoryChart({
  points,
  avgCost = 0,
}: {
  points: PricePoint[];
  avgCost?: number;
}) {
  const gradId = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<PriceHistoryRange>("6M");

  const visiblePoints = useMemo(() => filterPricePointsByRange(points, range), [points, range]);

  const lifetime = useMemo(() => {
    if (!points.length) return null;
    let high = points[0];
    let low = points[0];
    for (const point of points.slice(1)) {
      if (point.price > high.price) high = point;
      if (point.price < low.price) low = point;
    }
    return { high, low };
  }, [points]);

  const { path, area, avgCostY, xs, ys, min, max } = useMemo(() => {
    const vals = visiblePoints.map((p) => p.price);
    if (avgCost > 0) vals.push(avgCost);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (!isFinite(min)) {
      min = 0;
      max = 1;
    }
    if (max - min < 1e-6) {
      min = min * 0.9;
      max = max * 1.1 || 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const n = visiblePoints.length;
    const xs = visiblePoints.map((_, i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r)));
    const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
    const ys = visiblePoints.map((p) => y(p.price));
    const line = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${v.toFixed(1)}`).join(" ");
    const path = line(ys);
    const area = n ? `${path} L${xs[n - 1]},${H - P.b} L${xs[0]},${H - P.b} Z` : "";
    return {
      path,
      area,
      avgCostY: avgCost > 0 ? y(avgCost) : null,
      xs,
      ys,
      min,
      max,
    };
  }, [visiblePoints, avgCost]);

  if (points.length === 0) {
    return (
      <div className="grid h-[200px] place-items-center text-center text-sm text-slate-400">
        Daily price snapshots appear automatically once a price is set.
      </div>
    );
  }

  const startPrice = visiblePoints[0].price;
  const activeIndex = hover !== null && hover < visiblePoints.length ? hover : visiblePoints.length - 1;
  const activePoint = visiblePoints[activeIndex];
  const delta = visiblePoints.length > 1 ? activePoint.price - startPrice : 0;
  const deltaPct = visiblePoints.length > 1 && startPrice > 0 ? delta / startPrice : 0;
  const up = activePoint.price >= startPrice;
  const stroke = up ? "#9ed5ff" : "#fb8395";

  function scrubAtClientX(svg: SVGSVGElement, clientX: number) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    xs.forEach((v, i) => {
      if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
    });
    setHover(best);
  }

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="Price history period">
        {PRICE_HISTORY_RANGES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setRange(item.value);
              setHover(null);
            }}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
              range === item.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
            aria-pressed={range === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>

      {lifetime && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">All-time high</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(lifetime.high.price)}</div>
            <div className="text-xs text-slate-500">{fmtDate(lifetime.high.date)}</div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">All-time low</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(lifetime.low.price)}</div>
            <div className="text-xs text-slate-500">{fmtDate(lifetime.low.date)}</div>
          </div>
        </div>
      )}

      <div className="mb-2 flex flex-col gap-1 text-sm sm:flex-row sm:items-baseline sm:justify-between">
        <span className="text-slate-500">{fmtDate(activePoint.date)}</span>
        <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
          <span>
            <span className="text-slate-400">Price </span>
            <span className="font-semibold text-slate-900">{money(activePoint.price)}</span>
          </span>
          {visiblePoints.length > 1 && (
            <span className={`text-xs font-semibold ${pnlColor(delta)}`}>
              {money(delta, { sign: true })} ({pct(deltaPct)})
            </span>
          )}
          {avgCost > 0 && (
            <span>
              <span className="text-slate-400">Avg cost </span>
              <span className="font-medium text-slate-600">{money(avgCost)}</span>
            </span>
          )}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full touch-pan-y select-none"
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily snapshot price history chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => scrubAtClientX(e.currentTarget, e.clientX)}
        onTouchStart={(e) => {
          if (e.touches[0]) scrubAtClientX(e.currentTarget, e.touches[0].clientX);
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) scrubAtClientX(e.currentTarget, e.touches[0].clientX);
        }}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`price-fill-${gradId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            className="history-grid-line"
            key={f}
            x1={P.l}
            x2={W - P.r}
            y1={P.t + f * (H - P.t - P.b)}
            y2={P.t + f * (H - P.t - P.b)}
          />
        ))}
        {avgCostY !== null && (
          <line
            x1={P.l}
            x2={W - P.r}
            y1={avgCostY}
            y2={avgCostY}
            stroke="#94a3b8"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {visiblePoints.length > 1 && <path d={area} fill={`url(#price-fill-${gradId})`} />}
        <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {visiblePoints.length === 1 && <circle cx={xs[0]} cy={ys[0]} r="5" fill={stroke} />}
        {hover !== null && hover < xs.length && (
          <>
            <line
              className="history-hover-line"
              x1={xs[hover]}
              x2={xs[hover]}
              y1={P.t}
              y2={H - P.b}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className="history-hover-dot"
              cx={xs[hover]}
              cy={ys[hover]}
              r="4"
              stroke={stroke}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        <text x={P.l} y={H - 6} fontSize="11" fill="#94a3b8">
          {fmtDate(visiblePoints[0].date)}
        </text>
        {visiblePoints.length > 1 && (
          <text x={W - P.r} y={H - 6} fontSize="11" fill="#94a3b8" textAnchor="end">
            {fmtDate(visiblePoints[visiblePoints.length - 1].date)}
          </text>
        )}
      </svg>

      {points.length === 1 && (
        <p className="mt-2 text-xs text-slate-400">
          First daily snapshot recorded for {fmtDate(points[0].date)}. A new snapshot point is added automatically each day.
        </p>
      )}
      <span className="sr-only">
        Price range {money(min)} to {money(max)}
      </span>
    </div>
  );
}
