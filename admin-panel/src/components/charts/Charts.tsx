import { useMemo, useRef, useState } from 'react';

/**
 * Small, dependency-free charts for the admin dashboards (dataviz spec: single validated hue
 * var(--chart-1), <=24px bars with 4px rounded data-end square at the baseline, hairline solid grid,
 * per-mark hover tooltip with value first, text in ink tokens, a table view for every chart).
 */

/** Clean axis maximum + ticks (1/2/5 x 10^n steps). */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

const fmt = (n: number) => new Intl.NumberFormat('es-CO').format(n);

export interface Point {
  key: string;
  label: string;
  value: number;
}

/** Column chart over time (one bar per day) with a hover tooltip and an optional table view. */
export function ColumnChart({ data, valueLabel, height = 220 }: { data: Point[]; valueLabel: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ticks = useMemo(() => niceTicks(Math.max(...data.map((d) => d.value), 0)), [data]);
  const top = ticks[ticks.length - 1] || 1;
  const W = 720;
  const H = height;
  const pad = { l: 40, r: 8, t: 12, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = data.length ? plotW / data.length : plotW;
  const barW = Math.max(2, Math.min(24, band - 2)); // 2px surface gap between adjacent bars
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const y = (v: number) => pad.t + plotH - (v / top) * plotH;

  const bar = (x: number, v: number) => {
    const h = Math.max(0, (v / top) * plotH);
    const r = Math.min(4, h, barW / 2);
    const yTop = pad.t + plotH - h;
    // rounded top (data end), square at the baseline
    return `M${x},${pad.t + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${pad.t + plotH} Z`;
  };

  const hovered = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? ((pad.l + band * hover + band / 2) / W) * 100 : 0;

  return (
    <div ref={wrap} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${valueLabel} por día`} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-gray-dark text-[11px]">
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + band * i + (band - barW) / 2;
          return (
            <g key={d.key}>
              {d.value > 0 && <path d={bar(x, d.value)} fill="var(--chart-1)" opacity={hover === null || hover === i ? 1 : 0.45} className="transition-opacity" />}
              {/* hit target: the whole band, taller than the mark */}
              <rect
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.label}: ${fmt(d.value)} ${valueLabel}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="cursor-crosshair outline-none"
              />
              {i % labelEvery === 0 && (
                <text x={pad.l + band * i + band / 2} y={H - 8} textAnchor="middle" className="fill-gray-dark text-[11px]">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-gray-medium/70 bg-white px-3 py-2 text-xs shadow-lift dark:border-white/10 dark:bg-[#1a1f45]"
          style={{ left: `${Math.min(Math.max(tipLeft, 12), 88)}%` }}
        >
          <p className="font-display text-base font-black text-ink dark:text-white">{fmt(hovered.value)}</p>
          <p className="flex items-center gap-1.5 text-gray-dark">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: 'var(--chart-1)' }} />
            {valueLabel} · {hovered.label}
          </p>
        </div>
      )}
    </div>
  );
}

/** Horizontal ranked bars (category -> count), label left, value at the tip. */
export function BarList({ data, total, empty = 'Sin datos todavía.' }: { data: { name: string; value: number }[]; total?: number; empty?: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!data.length) return <p className="py-6 text-center text-sm text-gray-dark">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.name} className="group" title={`${d.name}: ${fmt(d.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-semibold text-ink dark:text-white/90">{d.name}</span>
            <span className="shrink-0 font-bold tabular-nums text-ink dark:text-white">
              {fmt(d.value)}
              {total ? <span className="ml-1.5 text-xs font-medium text-gray-dark">{Math.round((d.value / total) * 100)}%</span> : null}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-[var(--chart-grid)]">
            <div className="h-full rounded-r-[4px] rounded-l-full transition-all group-hover:brightness-110" style={{ width: `${(d.value / max) * 100}%`, background: 'var(--chart-1)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Step funnel: each step's bar relative to the first, with the conversion from the previous step. */
export function Funnel({ steps }: { steps: { step: string; value: number }[] }) {
  const first = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.step}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-ink dark:text-white/90">
                {i + 1}. {s.step}
              </span>
              <span className="font-bold tabular-nums text-ink dark:text-white">
                {fmt(s.value)}
                {conv !== null && <span className="ml-1.5 text-xs font-medium text-gray-dark">{conv}% del paso anterior</span>}
              </span>
            </div>
            <div className="h-6 rounded-lg bg-[var(--chart-grid)]">
              <div className="h-full rounded-r-[4px] rounded-l-lg" style={{ width: `${Math.max((s.value / first) * 100, s.value ? 2 : 0)}%`, background: 'var(--chart-1)' }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Accessible table view for any chart's data. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-xl border border-gray-medium/70 dark:border-white/10">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-light dark:bg-[#121636]">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-gray-dark">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-gray-medium/50 dark:border-white/5">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1.5 ${typeof c === 'number' ? 'text-right tabular-nums' : ''} text-ink dark:text-white/85`}>
                  {typeof c === 'number' ? fmt(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
