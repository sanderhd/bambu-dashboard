'use client';
// Column chart (optionally stacked) in plain SVG.
// Thin columns (≤ 24px), 4px rounded data-end and square at the baseline, a 2px surface gap
// between stacked segments, hairline grid, a tooltip on hover and keyboard focus,
// and a table view so no value depends on hovering.
import { useEffect, useRef, useState } from 'react';

export type Series = { name: string; color: string };
export type Bucket = { label: string; title: string; values: number[] };

const H = 180;            // plot height
const AXIS = 22;          // x-axis label band
const LEFT = 40;          // y-axis label band
const MAX_BAR = 24;
const GAP = 2;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** Path for a column: rounded top corners only, square at the baseline. */
function column(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
}

export default function BarChart({ title, buckets, series, format, emptyText }: {
  title: string;
  buckets: Bucket[];
  series: Series[];
  format: (v: number) => string;
  emptyText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = buckets.map((b) => b.values.reduce((a, v) => a + v, 0));
  const hasData = totals.some((t) => t > 0);
  const max = niceMax(Math.max(0, ...totals));
  const plotW = w - LEFT - 4;
  const band = buckets.length ? plotW / buckets.length : plotW;
  const barW = Math.max(3, Math.min(MAX_BAR, band * 0.6));
  const y = (v: number) => H - (v / max) * H;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 56))));

  return (
    <div className="chart-block">
      <div className="row chart-head">
        <b>{title}</b>
        {series.length > 1 && (
          <span className="legend" aria-hidden>
            {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
          </span>
        )}
        <span className="spacer" />
        <button className="linklike small" onClick={() => setTable(!table)} aria-pressed={table}>{table ? 'Show chart' : 'Show table'}</button>
      </div>

      {table ? (
        <table className="data-table">
          <thead><tr><th>Period</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}{series.length > 1 && <th>Total</th>}</tr></thead>
          <tbody>
            {buckets.map((b, i) => (
              <tr key={b.title}><td>{b.title}</td>{b.values.map((v, j) => <td key={j}>{format(v)}</td>)}{series.length > 1 && <td>{format(totals[i])}</td>}</tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={ref}>
          {!hasData && <div className="chart-empty">{emptyText ?? 'No data in this period'}</div>}
          <svg width={w} height={H + AXIS + 8} role="img" aria-label={title} style={{ display: 'block' }}>
            <g transform="translate(0,6)">
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={LEFT} x2={w - 4} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
                  <text x={LEFT - 6} y={y(t) + 4} textAnchor="end" className="tick">{format(t)}</text>
                </g>
              ))}
              {buckets.map((b, i) => {
                const cx = LEFT + band * i + band / 2;
                let acc = 0;
                const last = b.values.reduce((li, v, j) => (v > 0 ? j : li), -1);
                return (
                  <g key={b.title}>
                    {b.values.map((v, j) => {
                      if (v <= 0) return null;
                      const top = y(acc + v), bottom = y(acc);
                      acc += v;
                      // 2px surface gap between stacked segments (taken off the lower segment's top)
                      const h = Math.max(1, bottom - top - (j < last ? GAP : 0));
                      return <path key={j} d={column(cx - barW / 2, j < last ? top + GAP : top, barW, j < last ? h : bottom - top, j === last)} fill={series[j].color} opacity={hover === null || hover === i ? 1 : 0.55} />;
                    })}
                    {i % labelEvery === 0 && <text x={cx} y={H + 16} textAnchor="middle" className="tick">{b.label}</text>}
                    {/* hit target: the whole band, not just the painted column */}
                    <rect x={LEFT + band * i} y={0} width={band} height={H} fill="transparent" tabIndex={0}
                      aria-label={`${b.title}: ${series.map((s, j) => `${s.name} ${format(b.values[j])}`).join(', ')}`}
                      onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                  </g>
                );
              })}
            </g>
          </svg>
          {hover !== null && buckets[hover] && (
            <div className="chart-tip" style={{ left: Math.min(w - 170, Math.max(0, LEFT + band * hover + band / 2 - 80)) }}>
              <div className="muted small">{buckets[hover].title}</div>
              {series.map((s, j) => (
                <div key={s.name} className="tip-row"><i style={{ background: s.color }} /><b>{format(buckets[hover].values[j])}</b><span className="muted">{s.name}</span></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
