// Reads the printer's smart plug from Home Assistant: live power (W) and energy (kWh) per print.
import 'server-only';
import { getPrinter } from './printer';
import { getSettings, settingsEvents } from './settings';
import type { HaSettings, PrintJob } from './types';

const POLL_MS = 10_000;
const TIMEOUT_MS = 5_000;

type State = { value: number; unit: string };

/** Reads one entity's state through the Home Assistant REST API. */
export async function readEntity(ha: Pick<HaSettings, 'url' | 'token'>, entity: string): Promise<State> {
  const res = await fetch(`${ha.url}/api/states/${encodeURIComponent(entity)}`, {
    headers: { Authorization: `Bearer ${ha.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  }).catch((e) => {
    const cause = e?.cause?.code ?? e?.name ?? e?.message;
    throw new Error(cause === 'TimeoutError' ? 'Home Assistant did not answer within 5 seconds' : `Can't reach Home Assistant (${cause})`);
  });
  if (res.status === 401) throw new Error('Home Assistant refused the token (401)');
  if (res.status === 404) throw new Error(`Entity ${entity} not found`);
  if (!res.ok) throw new Error(`Home Assistant answered HTTP ${res.status}`);
  const j = await res.json();
  const value = Number(j.state);
  if (!Number.isFinite(value)) throw new Error(`${entity} has no number right now (state: ${j.state})`);
  return { value, unit: String(j.attributes?.unit_of_measurement ?? '') };
}

const toWatts = (s: State) => (s.unit === 'kW' ? s.value * 1000 : s.value);
const toKwh = (s: State) => (s.unit === 'Wh' ? s.value / 1000 : s.unit === 'MWh' ? s.value * 1000 : s.value);

class HomeAssistant {
  private timer: NodeJS.Timeout | null = null;
  private jobStartKwh: number | null = null;

  constructor() {
    const printer = getPrinter();
    printer.on('jobStarted', () => this.onJobStarted());
    printer.on('jobFinished', (job: PrintJob) => this.onJobFinished(job));
    settingsEvents.on('change', () => this.restart());
    this.restart();
  }

  private get ha() { return getSettings().ha; }

  private restart() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const printer = getPrinter();
    if (!this.ha?.powerEntity && !this.ha?.energyEntity) { printer.power = null; printer.jobEnergyKwh = null; return; }
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  private async poll() {
    const ha = this.ha;
    if (!ha) return;
    const printer = getPrinter();
    if (ha.powerEntity) {
      try {
        printer.power = { watts: Math.round(toWatts(await readEntity(ha, ha.powerEntity)) * 10) / 10, at: Date.now(), error: null };
      } catch (e) {
        printer.power = { watts: null, at: Date.now(), error: (e as Error).message };
      }
      printer.emit('power', printer.power);
    }
    // Energy used by the running print so far.
    if (ha.energyEntity && this.jobStartKwh !== null) {
      try {
        const kwh = toKwh(await readEntity(ha, ha.energyEntity));
        printer.jobEnergyKwh = Math.max(0, Math.round((kwh - this.jobStartKwh) * 1000) / 1000);
        printer.emit('jobEnergy', printer.jobEnergyKwh);
      } catch { /* shown via the power error */ }
    }
  }

  private async onJobStarted() {
    const ha = this.ha;
    this.jobStartKwh = null;
    getPrinter().jobEnergyKwh = null;
    if (!ha?.energyEntity) return;
    try {
      this.jobStartKwh = toKwh(await readEntity(ha, ha.energyEntity));
      getPrinter().jobEnergyKwh = 0;
    } catch (e) {
      console.warn('[homeassistant] energy at print start:', (e as Error).message);
    }
  }

  private async onJobFinished(job: PrintJob) {
    const ha = this.ha;
    const start = this.jobStartKwh;
    this.jobStartKwh = null;
    const printer = getPrinter();
    printer.jobEnergyKwh = null;
    if (!ha?.energyEntity || start === null) return;
    try {
      const used = toKwh(await readEntity(ha, ha.energyEntity)) - start;
      // A meter reset (or a swapped plug) gives a negative or absurd value: skip it.
      if (used >= 0 && used < 50) {
        job.energyKwh = Math.round(used * 1000) / 1000;
        printer.saveHistory();
      }
    } catch (e) {
      console.warn('[homeassistant] energy at print end:', (e as Error).message);
    }
  }
}

const g = globalThis as unknown as { __bambuHa?: HomeAssistant };
export const initHomeAssistant = () => (g.__bambuHa ??= new HomeAssistant());
