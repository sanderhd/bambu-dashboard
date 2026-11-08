'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Connection, PrintJob, PrinterInfo, PrintState, TempSample } from '@/lib/types';

/** Live printer state over Server-Sent Events. */
export function usePrinter() {
  const [state, setState] = useState<PrintState>({});
  const [connection, setConnection] = useState<Connection | null>(null);
  const [tempHistory, setTempHistory] = useState<TempSample[]>([]);
  const [printHistory, setPrintHistory] = useState<PrintJob[]>([]);
  const [printer, setPrinter] = useState<PrinterInfo | null>(null);
  const [demo, setDemo] = useState(false);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('init', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setState(d.state); setConnection(d.connection); setTempHistory(d.tempHistory);
      setPrintHistory(d.printHistory); setDemo(d.demo); setPrinter(d.printer);
      setServerDown(false);
    });
    es.addEventListener('state', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { state: PrintState; connection: Connection };
      setState(d.state); setConnection(d.connection);
      const s = d.state;
      if (s.nozzle_temper != null) {
        setTempHistory((h) => {
          const last = h[h.length - 1];
          if (last && Date.now() - last.t < 4000) return h;
          const next = [...h, { t: Date.now(), nozzle: s.nozzle_temper!, nozzleTarget: s.nozzle_target_temper ?? 0, bed: s.bed_temper ?? 0, bedTarget: s.bed_target_temper ?? 0 }];
          return next.length > 720 ? next.slice(-720) : next;
        });
      }
    });
    es.addEventListener('history', (e) => setPrintHistory(JSON.parse((e as MessageEvent).data)));
    es.onerror = async () => {
      // EventSource hides the status code: ask whether the session expired.
      try {
        const r = await fetch('/api/auth/session');
        if (r.status === 401) { window.location.href = '/login'; return; }
      } catch { /* server down */ }
      setServerDown(true);
    };
    return () => es.close();
  }, []);

  const command = useCallback(async (action: string, value?: unknown) => {
    try {
      const r = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, value }) });
      if (r.status === 401) { window.location.href = '/login'; return 'Not logged in'; }
      const j = await r.json();
      return j.ok ? 'Command sent' : `Failed: ${j.error}`;
    } catch {
      return 'Server unreachable';
    }
  }, []);

  return { state, connection, tempHistory, printHistory, printer, demo, serverDown, command };
}
