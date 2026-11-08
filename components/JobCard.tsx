'use client';
import type { PrintState } from '@/lib/types';
import { STATES, STAGES, SPEEDS, fmtDur } from '@/lib/format';

const C = 2 * Math.PI * 60;

export default function JobCard({ s, send, energyKwh }: { s: PrintState; send: (a: string, v?: unknown) => void; energyKwh?: number | null }) {
  const gs = s.gcode_state;
  const active = gs === 'RUNNING' || gs === 'PAUSE' || gs === 'PREPARE';
  const pct = s.mc_percent ?? 0;
  const color = gs === 'FAILED' ? 'var(--bad)' : gs === 'PAUSE' ? 'var(--warn)' : 'var(--accent)';
  const name = (gs && gs !== 'IDLE' && (s.subtask_name || s.gcode_file)) || 'No active print';
  const stage = s.stg_cur != null ? STAGES[s.stg_cur] : undefined;
  const eta = active && s.mc_remaining_time != null
    ? new Date(Date.now() + s.mc_remaining_time * 60000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '–';
  const light = s.lights_report?.find((l) => l.node === 'chamber_light');
  const lightOn = light?.mode === 'on';

  const stop = () => {
    if (confirm('Are you sure you want to stop this print? This cannot be undone.')) send('stop');
  };

  return (
    <section className="card s7">
      <h2>Current print</h2>
      <div className="job">
        <div className="ring">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="60" fill="none" stroke="var(--line)" strokeWidth="12" />
            <circle className="arc" cx="70" cy="70" r="60" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C - (C * pct) / 100} />
          </svg>
          <div className="pct">{gs ? `${pct}%` : '–'}</div>
        </div>
        <div className="job-info">
          <p className="job-name">{name}</p>
          <div>
            <span className="state">{STATES[gs ?? ''] || gs || '–'}</span>{' '}
            {stage && <span className="muted">· {stage}</span>}
          </div>
          <div className="kv">
            <div><span>Layer</span><b>{s.total_layer_num ? `${s.layer_num ?? 0} / ${s.total_layer_num}` : '–'}</b></div>
            <div><span>Remaining</span><b>{active ? fmtDur(s.mc_remaining_time) : '–'}</b></div>
            <div><span>Done at</span><b>{eta}</b></div>
            <div><span>Speed</span><b>{s.spd_lvl ? `${SPEEDS[s.spd_lvl]}${s.spd_mag ? ` (${s.spd_mag}%)` : ''}` : '–'}</b></div>
            {active && energyKwh != null && <div><span>Energy so far</span><b>{energyKwh.toFixed(2)} kWh</b></div>}
          </div>
        </div>
      </div>

      <div className="label">Controls</div>
      <div className="row">
        <button className="btn" disabled={gs !== 'RUNNING' && gs !== 'PREPARE'} onClick={() => send('pause')}>⏸ Pause</button>
        <button className="btn primary" disabled={gs !== 'PAUSE'} onClick={() => send('resume')}>▶ Resume</button>
        <button className="btn danger" disabled={!active} onClick={stop}>■ Stop</button>
        <span className="spacer" />
        {light && <button className="btn" onClick={() => send('light', !lightOn)}>💡 Light {lightOn ? 'off' : 'on'}</button>}
      </div>

      <div className="label">Print speed</div>
      <div className="seg">
        {[1, 2, 3, 4].map((v) => (
          <button key={v} className={s.spd_lvl === v ? 'on' : ''} onClick={() => send('speed', v)}>{SPEEDS[v]}</button>
        ))}
      </div>
    </section>
  );
}
