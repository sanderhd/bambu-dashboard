'use client';
import type { AmsUnit, PrintState, Tray } from '@/lib/types';

function TraySlot({ t, label, active }: { t: Tray; label: string; active: boolean }) {
  const empty = !t.tray_type;
  const color = empty ? 'transparent' : '#' + (t.tray_color || '888888FF').slice(0, 6);
  const remain = typeof t.remain === 'number' && t.remain >= 0 ? t.remain : null;
  return (
    <div className={`slot ${active ? 'active' : ''}`}>
      {active && <span className="tag">Active</span>}
      <div className="spool" style={{ borderColor: empty ? 'var(--line)' : color, background: color }} />
      <b>{label}</b>
      <span>{empty ? 'Empty' : t.tray_sub_brands || t.tray_type}</span>
      {!empty && t.nozzle_temp_min && <span>{t.nozzle_temp_min}–{t.nozzle_temp_max}°</span>}
      {remain != null ? (
        <>
          <div className="bar"><i style={{ width: `${remain}%` }} /></div>
          <span>{remain}% left</span>
        </>
      ) : !empty && <span>Amount unknown</span>}
    </div>
  );
}

// AMS lite reports temp "0.0" and no useful humidity; only show climate data for a full AMS.
function climate(u: AmsUnit) {
  const parts: string[] = [];
  if (u.humidity_raw && Number(u.humidity_raw) > 0) parts.push(`${u.humidity_raw}% humidity`);
  else if (u.temp && Number(u.temp) > 0 && u.humidity) parts.push(`Humidity level ${u.humidity}/5`);
  if (u.temp && Number(u.temp) > 0) parts.push(`${Math.round(Number(u.temp))}°C`);
  return parts.join(' · ');
}

export default function AmsCard({ s }: { s: PrintState }) {
  const units = s.ams?.ams ?? [];
  const now = s.ams?.tray_now;
  const multi = units.length > 1;
  const ext = s.vt_tray;

  return (
    <section className="card s6">
      <h2>Filament</h2>
      {!units.length && !ext && <span className="muted">No AMS data</span>}
      {units.map((u) => {
        const letter = String.fromCharCode(65 + Number(u.id)); // AMS 0 → A, 1 → B, …
        const info = climate(u);
        return (
          <div key={u.id} style={{ marginBottom: 12 }}>
            {(multi || info) && (
              <div className="label" style={{ marginTop: 0 }}>AMS {letter}{info && ` · ${info}`}</div>
            )}
            <div className="ams">
              {(u.tray ?? []).map((t) => {
                const globalId = String(Number(u.id) * 4 + Number(t.id));
                return <TraySlot key={t.id} t={t} label={`${letter}${Number(t.id) + 1}`} active={now === globalId} />;
              })}
            </div>
          </div>
        );
      })}
      {ext && (
        <>
          {!!units.length && <div className="label">External spool</div>}
          <div className="ams"><TraySlot t={ext} label="External" active={now === '254'} /></div>
        </>
      )}
    </section>
  );
}
