'use client';
import { useEffect, useRef, useState } from 'react';
import type { PrintState, TempSample } from '@/lib/types';
import { deg } from '@/lib/format';

const WINDOW = 30 * 60000;
const H = 170;

function Chart({ history }: { history: TempSample[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(600);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setNow(Date.now()), [history]);

  const cutoff = now - WINDOW;
  const pts = history.filter((p) => p.t >= cutoff);
  const max = Math.max(60, ...pts.map((p) => Math.max(p.nozzle, p.nozzleTarget || 0))) * 1.08;
  const x = (t: number) => ((t - cutoff) / WINDOW) * w;
  const y = (v: number) => H - 4 - (v / max) * (H - 8);
  const line = (k: keyof Omit<TempSample, 't'>) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');

  return (
    <svg ref={ref} className="chart" viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" role="img" aria-label="Temperature history">
      {pts.length > 1 && (
        <>
          {[50, 100, 150, 200, 250, 300].filter((v) => v < max).map((v) => (
            <g key={v}>
              <line x1="0" x2={w} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x="4" y={y(v) - 3} fontSize="10" fill="var(--muted)">{v}°</text>
            </g>
          ))}
          <path d={line('nozzleTarget')} fill="none" stroke="var(--nozzle)" strokeDasharray="4 4" opacity=".5" />
          <path d={line('bedTarget')} fill="none" stroke="var(--bed)" strokeDasharray="4 4" opacity=".5" />
          <path d={line('nozzle')} fill="none" stroke="var(--nozzle)" strokeWidth="2" />
          <path d={line('bed')} fill="none" stroke="var(--bed)" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

function Tile({ label, color, value, target }: { label: string; color: string; value?: number; target?: number }) {
  return (
    <div className="temp">
      <span><i className="swatch-line" style={{ background: color }} />{label}</span>
      <b>{deg(value)}</b>
      {!!target && <small>→ {Math.round(target)}°</small>}
    </div>
  );
}

export default function TempCard({ s, history }: { s: PrintState; history: TempSample[] }) {
  const hasChamber = typeof s.chamber_temper === 'number' && s.chamber_temper > 0;
  return (
    <section className="card s6">
      <h2>Temperatures</h2>
      <div className="temps" style={hasChamber ? { gridTemplateColumns: 'repeat(3, 1fr)' } : undefined}>
        <Tile label="Nozzle" color="var(--nozzle)" value={s.nozzle_temper} target={s.nozzle_target_temper} />
        <Tile label="Bed" color="var(--bed)" value={s.bed_temper} target={s.bed_target_temper} />
        {hasChamber && <Tile label="Chamber" color="var(--muted)" value={s.chamber_temper} />}
      </div>
      <Chart history={history} />
      <div className="muted">Last 30 minutes · dashed line = target temperature</div>
    </section>
  );
}
