// Push notifications via Pushbullet and/or a Discord webhook: print started/finished/failed/paused,
// new HMS alerts and maintenance that became due. Configured under Settings → Notifications.
import 'server-only';
import fs from 'fs';
import path from 'path';
import { getCameraHub } from './cameras';
import { fmtDur, hmsCode, STAGES } from './format';
import { listTasks } from './maintenance';
import { getPrinter } from './printer';
import { DEFAULT_EVENTS, getSettings } from './settings';
import type { NotifyEvent, NotifySettings, PrintJob } from './types';

const STATE_FILE = path.join(process.cwd(), 'data', 'notify-state.json');
const TIMEOUT_MS = 15_000;
const FINISH_DELAY_MS = 8_000; // lets Home Assistant add the energy used to the finished job first
const MAINTENANCE_CHECK_MS = 10 * 60 * 1000;
const CANCELLED = 0x0300400c; // print_error when a print is stopped from the printer, Studio or Handy

const COLORS = { ok: 0x2fb36b, bad: 0xe5484d, warn: 0xf0a020, info: 0x3b82f6 };

export type Message = {
  title: string;
  lines: string[];
  color: number;
  /** Expected finish time; Discord shows it in the reader's own time zone. */
  eta?: number;
  image?: Buffer | null;
};

type Result = { service: 'Pushbullet' | 'Discord'; ok: boolean; message: string };

// ---------------------------------------------------------------- services
async function request(url: string, init: RequestInit, service: string) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' }).catch((e) => {
    const cause = e?.cause?.code ?? e?.name ?? e?.message;
    throw new Error(cause === 'TimeoutError' ? `${service} did not answer within 15 seconds` : `Can't reach ${service} (${cause})`);
  });
}

const blob = (jpg: Buffer) => new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' });

async function sendDiscord(webhook: string, m: Message) {
  const printer = getPrinter().info.name;
  let description = m.lines.join('\n');
  if (m.eta) {
    const t = Math.round(m.eta / 1000);
    description += `\nReady around <t:${t}:t> (<t:${t}:R>)`;
  }
  const embed: Record<string, unknown> = {
    title: m.title, description, color: m.color,
    footer: { text: printer }, timestamp: new Date().toISOString(),
  };
  const payload: Record<string, unknown> = { username: 'Bambu Dashboard', embeds: [embed] };
  const form = new FormData();
  if (m.image) {
    embed.image = { url: 'attachment://snapshot.jpg' };
    payload.attachments = [{ id: 0, filename: 'snapshot.jpg' }];
    form.append('files[0]', blob(m.image), 'snapshot.jpg');
  }
  form.append('payload_json', JSON.stringify(payload));
  const res = await request(`${webhook}?wait=true`, { method: 'POST', body: form }, 'Discord');
  if (res.status === 401 || res.status === 404) throw new Error('Discord doesn\'t know this webhook (was it deleted?)');
  if (res.status === 429) throw new Error('Discord is rate limiting this webhook, try again in a minute');
  if (!res.ok) throw new Error(`Discord answered HTTP ${res.status}`);
}

async function pushbullet(token: string, endpoint: string, body: object) {
  const res = await request(`https://api.pushbullet.com/v2/${endpoint}`, {
    method: 'POST',
    headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Pushbullet');
  if (res.status === 401 || res.status === 403) throw new Error('Pushbullet refused the access token');
  if (res.status === 429) throw new Error('Pushbullet rate limit reached, try again later');
  if (!res.ok) throw new Error(`Pushbullet answered HTTP ${res.status}`);
  return res.json();
}

async function sendPushbullet(token: string, m: Message) {
  const title = `${getPrinter().info.name}: ${m.title}`;
  const body = m.lines.join('\n');
  if (m.image) {
    // Files go in three steps: ask for an upload URL, upload, then push the file's URL.
    try {
      const up = await pushbullet(token, 'upload-request', { file_name: 'snapshot.jpg', file_type: 'image/jpeg' });
      const form = new FormData();
      form.append('file', blob(m.image), 'snapshot.jpg');
      const res = await request(up.upload_url, { method: 'POST', body: form }, 'Pushbullet');
      if (!res.ok) throw new Error(`upload failed (HTTP ${res.status})`);
      await pushbullet(token, 'pushes', { type: 'file', title, body, file_name: up.file_name, file_type: up.file_type, file_url: up.file_url });
      return;
    } catch (e) {
      if ((e as Error).message.includes('access token')) throw e;
      console.warn('[notify] Pushbullet image upload failed, sending text only:', (e as Error).message);
    }
  }
  await pushbullet(token, 'pushes', { type: 'note', title, body });
}

/** Sends a message to every configured service. Never throws; returns one result per service. */
export async function send(m: Message, cfg: Pick<NotifySettings, 'pushbullet' | 'discord'> | undefined = getSettings().notify) {
  const jobs: Promise<Result>[] = [];
  const run = (service: Result['service'], fn: () => Promise<void>) =>
    jobs.push(fn().then(
      () => ({ service, ok: true, message: 'Sent' }),
      (e) => {
        console.warn(`[notify] ${service}:`, (e as Error).message);
        return { service, ok: false, message: (e as Error).message };
      },
    ));
  if (cfg?.pushbullet) run('Pushbullet', () => sendPushbullet(cfg.pushbullet!, m));
  if (cfg?.discord) run('Discord', () => sendDiscord(cfg.discord!, m));
  return Promise.all(jobs);
}

/** A camera image for a notification, or null when turned off or no camera works. */
export async function snapshotFor(cfg: Pick<NotifySettings, 'snapshot' | 'camera'> | undefined = getSettings().notify) {
  if (!(cfg?.snapshot ?? true)) return null;
  const hub = getCameraHub();
  const ids = hub.list().map((c) => c.id);
  const id = [cfg?.camera, getSettings().defaultCamera, 'printer'].find((c) => c && ids.includes(c)) ?? ids[0];
  if (!id) return null;
  try { return await hub.snapshot(id); } catch { return null; }
}

// ---------------------------------------------------------------- printer events
const errorHex = (n: number) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

class Notifier {
  private lastGs?: string;
  private startPending = false;
  private seenHms: Set<string> | null = null;
  private dueSent = new Set<string>();

  constructor() {
    try { this.dueSent = new Set(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).maintenance); } catch { /* none yet */ }
    const p = getPrinter();
    // Emitted before 'state', so lastGs is still the previous state here. When it's unknown the
    // dashboard just started during a print: that print isn't new, so don't announce it.
    p.on('jobStarted', () => { this.startPending = this.lastGs !== undefined; });
    p.on('state', () => this.onState());
    p.on('jobFinished', (job: PrintJob) => this.onJobFinished(job));
    setTimeout(() => this.checkMaintenance(), 60_000);
    setInterval(() => this.checkMaintenance(), MAINTENANCE_CHECK_MS);
  }

  private enabled(e: NotifyEvent) {
    const n = getSettings().notify;
    return !!(n?.pushbullet || n?.discord) && (n?.events ?? DEFAULT_EVENTS).includes(e);
  }

  private async notify(e: NotifyEvent, m: Message, withImage = false) {
    if (!this.enabled(e)) return;
    if (withImage) m.image = await snapshotFor();
    await send(m);
  }

  private onState() {
    const s = getPrinter().state;
    const gs = s.gcode_state;
    const prev = this.lastGs;
    if (gs) this.lastGs = gs;
    const name = s.subtask_name || s.gcode_file || 'Unknown';
    const where = s.total_layer_num ? `At ${s.mc_percent ?? 0}% (layer ${s.layer_num ?? 0} of ${s.total_layer_num})` : `At ${s.mc_percent ?? 0}%`;

    if (this.startPending && gs === 'RUNNING') {
      this.startPending = false;
      const min = s.mc_remaining_time;
      this.notify('started', {
        title: `▶️ Started: ${name}`,
        lines: min ? [`Takes about ${fmtDur(min)}`] : [],
        color: COLORS.info,
        eta: min ? Date.now() + min * 60_000 : undefined,
      });
    }
    if (gs === 'FINISH' || gs === 'FAILED' || gs === 'IDLE') this.startPending = false;

    if (gs === 'PAUSE' && prev && prev !== 'PAUSE') {
      const reason = s.stg_cur !== undefined ? STAGES[s.stg_cur] : undefined;
      const lines = [where];
      if (reason) lines.push(reason.replace(/^Paused: /, 'Reason: '));
      if (s.print_error) lines.push(`Error ${errorHex(s.print_error)}`);
      this.notify('paused', { title: `⏸️ Paused: ${name}`, lines, color: COLORS.warn }, true);
    }

    // HMS alerts: announce codes that weren't there in the previous report.
    if (s.hms !== undefined) {
      const codes = s.hms.map(hmsCode);
      const first = this.seenHms === null; // alerts already present at startup aren't new
      const fresh = first ? [] : codes.filter((c) => !this.seenHms!.has(c));
      this.seenHms = new Set(codes);
      if (fresh.length) {
        this.notify('hms', {
          title: fresh.length === 1 ? `⚠️ Printer alert` : `⚠️ ${fresh.length} printer alerts`,
          lines: fresh.map((c) => `HMS ${c}: https://wiki.bambulab.com/en/search?q=${c}`),
          color: COLORS.bad,
        }, true);
      }
    }
  }

  private onJobFinished(job: PrintJob) {
    const s = getPrinter().state;
    const where = s.total_layer_num ? `${s.mc_percent ?? 0}% (layer ${s.layer_num ?? 0} of ${s.total_layer_num})` : `${s.mc_percent ?? 0}%`;
    const error = s.print_error;
    // Wait a little: Home Assistant fills in the energy asynchronously.
    setTimeout(() => {
      const lines: string[] = [];
      if (job.printSeconds) lines.push(`Print time ${fmtDur(job.printSeconds / 60)}`);
      if (job.result === 'FINISH') {
        if (job.layers) lines.push(`${job.layers} layers`);
        if (job.grams != null) lines.push(`${job.grams} g filament`);
        if (job.energyKwh != null) lines.push(`${job.energyKwh} kWh`);
        if (job.counted) lines.push(`Counted for ${job.counted.projectName}: ${job.counted.partName} (+${job.counted.pieces})`);
        this.notify('finished', { title: `✅ Finished: ${job.name}`, lines, color: COLORS.ok }, true);
      } else {
        lines.unshift(error === CANCELLED ? `Cancelled at ${where}` : `Stopped at ${where}`);
        if (error && error !== CANCELLED) lines.push(`Error ${errorHex(error)}`);
        if (job.counted) lines.push(`Counted as failed for ${job.counted.projectName}: ${job.counted.partName}`);
        this.notify('failed', { title: `❌ Failed: ${job.name}`, lines, color: COLORS.bad }, true);
      }
    }, FINISH_DELAY_MS);
  }

  private checkMaintenance() {
    let due;
    try { due = listTasks().filter((t) => t.state === 'due'); } catch { return; }
    const keys = new Map(due.map((t) => [`${t.id}:${t.lastDoneAt}`, t]));
    const fresh = [...keys].filter(([k]) => !this.dueSent.has(k)).map(([, t]) => t);
    // Only remember tasks that are still due, so a task done and due again is announced again.
    const changed = fresh.length > 0 || [...this.dueSent].some((k) => !keys.has(k));
    if (fresh.length && this.enabled('maintenance')) {
      this.notify('maintenance', {
        title: fresh.length === 1 ? '🔧 Maintenance due' : `🔧 ${fresh.length} maintenance jobs due`,
        lines: fresh.map((t) => `• ${t.name}`),
        color: COLORS.warn,
      });
    }
    this.dueSent = new Set(keys.keys());
    if (changed) {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFile(STATE_FILE, JSON.stringify({ maintenance: [...this.dueSent] }), () => {});
    }
  }
}

const g = globalThis as unknown as { __bambuNotifier?: Notifier };
export const initNotifications = () => (g.__bambuNotifier ??= new Notifier());
