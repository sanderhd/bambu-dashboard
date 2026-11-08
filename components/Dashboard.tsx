'use client';
import { useEffect, useState } from 'react';
import { usePrinter } from '@/hooks/usePrinter';
import Header from './Header';
import JobCard from './JobCard';
import CameraCard from './CameraCard';
import TempCard from './TempCard';
import AmsCard from './AmsCard';
import ProjectsCard from './ProjectsCard';
import MaintenanceCard from './MaintenanceCard';
import { FansCard, AlertsCard, SystemCard, HistoryCard } from './InfoCards';
import type { Connection } from '@/lib/types';

const CONN: Record<Connection['status'], [string, string]> = {
  connected: ['ok', 'Connected'],
  demo: ['warn', 'Demo mode (fake data)'],
  connecting: ['warn', 'Connecting…'],
  offline: ['bad', 'Offline'],
  error: ['bad', 'Error'],
};

export default function Dashboard() {
  const { state, connection, tempHistory, printHistory, printer, serverDown, power, jobEnergyKwh, command } = usePrinter();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (printer) document.title = printer.name === printer.model ? `${printer.model} · Bambu Dashboard` : `${printer.name} · Bambu Dashboard`;
  }, [printer]);

  const send = async (action: string, value?: unknown) => {
    setToast(await command(action, value));
    setTimeout(() => setToast(null), 2200);
  };

  let [cls, text] = connection ? CONN[connection.status] : ['', 'Connecting…'];
  if (connection?.status === 'error' && connection.error) text = `Error: ${connection.error}`;
  if (serverDown) [cls, text] = ['bad', 'Dashboard server unreachable'];

  return (
    <>
      <Header
        title={printer?.name ?? 'Bambu Dashboard'}
        subtitle={printer && printer.name !== printer.model ? printer.model : undefined}
        active="dashboard"
      >
        <span className="badge"><span className={`dot ${cls}`} />{text}</span>
        <span className="badge" title="Wi-Fi signal">📶 {state.wifi_signal || '–'}</span>
        {power && (
          <span className="badge" title={power.error ?? 'Power use, from Home Assistant'}>
            ⚡ {power.watts != null ? `${Math.round(power.watts)} W` : 'n/a'}
          </span>
        )}
        <button className="btn" onClick={() => send('refresh')}>Refresh status</button>
      </Header>
      <main>
        <MaintenanceCard refreshKey={printHistory[0]?.ended ?? 0} />
        <JobCard s={state} send={send} energyKwh={jobEnergyKwh} />
        <CameraCard />
        <TempCard s={state} history={tempHistory} />
        <AmsCard s={state} />
        <FansCard s={state} />
        <AlertsCard s={state} />
        <SystemCard s={state} model={printer?.model} />
        <ProjectsCard refreshKey={printHistory[0]?.ended ?? 0} />
        <HistoryCard jobs={printHistory} />
        <section className="card s12">
          <details>
            <summary>All raw printer data</summary>
            <pre>{JSON.stringify(state, null, 2)}</pre>
          </details>
        </section>
      </main>
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}
