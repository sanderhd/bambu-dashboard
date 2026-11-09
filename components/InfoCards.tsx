'use client';
import Link from 'next/link';
import type { PrintJob, PrintState } from '@/lib/types';
import { fanPct, fmtDur, hmsCode } from '@/lib/format';

export function FansCard({ s }: { s: PrintState }) {
  const fans = ([
    ['Part cooling', s.cooling_fan_speed],
    ['Hotend', s.heatbreak_fan_speed],
    ['Auxiliary', s.big_fan1_speed],
    ['Chamber', s.big_fan2_speed],
  ] as const).filter(([, v]) => v != null);
  return (
    <section className="card s4">
      <h2>Fans</h2>
      {!fans.length ? <span className="muted">No data</span> : (
        <div className="fans">
          {fans.map(([n, v]) => {
            const p = fanPct(v) ?? 0;
            return (
              <div className="fan" key={n}>
                <span>{n}</span><b>{p}%</b>
                <div className="bar"><i style={{ width: `${p}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function AlertsCard({ s }: { s: PrintState }) {
  const hms = s.hms ?? [];
  return (
    <section className="card s4">
      <h2>Alerts</h2>
      {hms.map((h) => {
        const code = hmsCode(h);
        return (
          <div className="alert" key={code}>
            HMS {code}<br />
            <a className="muted" target="_blank" rel="noopener noreferrer" href={`https://wiki.bambulab.com/en/search?q=${code}`}>Look up on the Bambu wiki ↗</a>
          </div>
        );
      })}
      {!!s.print_error && (
        <div className="alert">Print error 0x{(s.print_error >>> 0).toString(16).toUpperCase().padStart(8, '0')}</div>
      )}
      {!hms.length && !s.print_error && <span className="ok-msg">✓ No alerts</span>}
    </section>
  );
}

const MODULE_NAMES: Record<string, string> = { ota: 'Firmware', mc: 'Motion controller', 'ams/0': 'AMS firmware' };

export function SystemCard({ s, model }: { s: PrintState; model?: string }) {
  const rows: [string, string | undefined][] = [
    ['Model', model],
    ['Nozzle', s.nozzle_diameter ? `${s.nozzle_diameter} mm${s.nozzle_type ? ' · ' + s.nozzle_type.replaceAll('_', ' ') : ''}` : undefined],
    ['Wi-Fi', s.wifi_signal],
    ['SD card', s.sdcard == null ? undefined : s.sdcard ? 'Inserted' : 'None'],
    ['File', s.gcode_file],
  ];
  (s.modules ?? []).forEach((m) => { if (m.sw_ver && MODULE_NAMES[m.name]) rows.push([MODULE_NAMES[m.name], m.sw_ver]); });
  return (
    <section className="card s4">
      <h2>Printer</h2>
      <ul className="list">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <li key={k}><span className="muted">{k}</span><span>{v}</span></li>
        ))}
      </ul>
    </section>
  );
}

const RECENT = 10;

export function HistoryCard({ jobs }: { jobs: PrintJob[] }) {
  return (
    <section className="card s12">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Recent prints</h2>
        <span className="spacer" />
        {jobs.length > 0 && <Link className="muted small" href="/history">All {jobs.length} prints, search and export →</Link>}
      </div>
      <ul className="list">
        {!jobs.length && <li className="muted">No prints recorded since the dashboard started.</li>}
        {jobs.slice(0, RECENT).map((h) => {
          const ok = h.result === 'FINISH';
          const dur = h.started ? fmtDur((h.ended - h.started) / 60000) : '';
          return (
            <li key={h.ended}>
              <span>
                <b>{h.name}</b><br />
                <span className="muted">
                  {new Date(h.ended).toLocaleString()}{dur && ` · ${dur}`}
                  {h.energyKwh != null && ` · ${h.energyKwh.toFixed(2)} kWh`}
                  {h.grams != null && ` · ${Math.round(h.grams)} g`}
                </span>
                {h.counted && (
                  <><br /><Link className="muted small" href={`/projects/${h.counted.projectId}`}>
                    Counted: {h.counted.projectName} → {h.counted.partName} ({ok ? '+' : '✗ '}{h.counted.pieces})
                  </Link></>
                )}
              </span>
              <span style={{ color: ok ? 'var(--accent)' : 'var(--bad)', fontWeight: 600 }}>{ok ? 'Succeeded' : 'Failed'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
