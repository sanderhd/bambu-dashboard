// Server-only: a single MQTT connection to the printer, shared by all API routes.
// Runs in the Next.js Node.js runtime; works with `next dev` and `next start` (not serverless).
// Cameras live in lib/cameras.ts.
import 'server-only';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import mqtt, { MqttClient } from 'mqtt';
import type { CameraMode, Connection, JobFilament, Power, PrintState, PrintJob, PrinterInfo, TempSample, Snapshot } from './types';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'print-history.json');
const USAGE_PATH = path.join(ROOT, 'data', 'printer-usage.json');
const TEMP_HISTORY_MAX = (60 * 60) / 5; // 1 hour at one sample every 5 s
const HISTORY_MAX = 5000; // plenty for years of statistics, still a small file
const TICK = 5; // seconds

export type Config = { printerIp: string; serial: string; accessCode: string; name?: string; camera?: CameraMode | 'auto' };

function loadConfig(): Config | null {
  if (process.env.BAMBU_DEMO === '1') return null;
  const env = process.env;
  if (env.BAMBU_IP && env.BAMBU_SERIAL && env.BAMBU_ACCESS_CODE) {
    return {
      printerIp: env.BAMBU_IP.trim(), serial: env.BAMBU_SERIAL.trim(), accessCode: env.BAMBU_ACCESS_CODE.trim(),
      name: env.BAMBU_NAME?.trim(), camera: env.BAMBU_CAMERA?.trim() as Config['camera'],
    };
  }
  if (!fs.existsSync(CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Model is derived from the first characters of the serial number.
const MODELS: [prefix: string, model: string, camera: CameraMode][] = [
  ['00M', 'X1 Carbon', 'rtsp'],
  ['00W', 'X1', 'rtsp'],
  ['03W', 'X1E', 'rtsp'],
  ['01P', 'P1S', 'jpeg'],
  ['01S', 'P1P', 'jpeg'],
  ['039', 'A1', 'jpeg'],
  ['030', 'A1 mini', 'jpeg'],
  ['094', 'H2D', 'rtsp'],
];

function detectPrinter(cfg: Config | null): PrinterInfo {
  if (!cfg) return { model: 'X1 Carbon', name: 'Demo printer', camera: 'off' };
  const hit = MODELS.find(([p]) => cfg.serial.toUpperCase().startsWith(p));
  const model = hit?.[1] ?? 'Bambu Lab printer';
  const camera = cfg.camera && cfg.camera !== 'auto' ? cfg.camera : hit?.[2] ?? 'jpeg';
  return { model, name: cfg.name || model, camera };
}

function deepMerge(target: Record<string, any>, src: Record<string, any>) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepMerge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

class Printer extends EventEmitter {
  readonly config = loadConfig();
  readonly demo = this.config === null;
  readonly info = detectPrinter(this.config);
  state: PrintState = {};
  connection: Connection = { status: this.demo ? 'demo' : 'connecting', since: Date.now(), error: null };
  tempHistory: TempSample[] = [];
  printHistory: PrintJob[] = [];
  /** Set by lib/homeassistant.ts when a smart plug is configured. */
  power: Power | null = null;
  jobEnergyKwh: number | null = null;
  /** Set by lib/filament.ts once the running print's file has been read. */
  jobFilament: JobFilament | null = null;
  private client: MqttClient | null = null;
  private lastGcodeState?: string;
  private jobStartedAt: number | null = null;
  private jobSeconds = 0;
  private lastPercent = 0;
  private usage = { printSeconds: 0 };
  private usageDirty = false;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.loadData();
    setInterval(() => this.tick(), TICK * 1000);
    setInterval(() => this.saveUsage(), 60_000);
    if (this.demo) this.startDemo(); else this.startMqtt();
  }

  snapshot(): Snapshot {
    return {
      state: this.state, connection: this.connection, tempHistory: this.tempHistory,
      printHistory: this.printHistory, demo: this.demo, printer: this.info,
      power: this.power, jobEnergyKwh: this.jobEnergyKwh,
    };
  }

  /** (Re)reads print history and usage from disk, e.g. after restoring a backup. */
  loadData() {
    try { this.printHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch { this.printHistory = []; }
    try { this.usage = { printSeconds: 0, ...JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8')) }; } catch { this.usage = { printSeconds: 0 }; }
    this.usageDirty = false;
    this.emit('history', this.printHistory);
  }

  /** Identifies the running print (its start time), or null when idle. */
  get jobId() { return this.jobStartedAt; }

  /** Hours spent printing since the dashboard started counting (add Settings → print hours for the total). */
  get countedPrintHours() { return this.usage.printSeconds / 3600; }

  /** Rewrites the history file and tells browsers, e.g. after energy was added to a finished job. */
  saveHistory() {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFile(HISTORY_PATH, JSON.stringify(this.printHistory), () => {});
    this.emit('history', this.printHistory);
  }

  private saveUsage() {
    if (!this.usageDirty) return;
    this.usageDirty = false;
    fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true });
    fs.writeFile(USAGE_PATH, JSON.stringify(this.usage), () => {});
  }

  private tick() {
    this.sampleTemps();
    // Count only time spent actually printing (not paused, not idle) towards print hours.
    if (this.state.gcode_state === 'RUNNING') {
      this.usage.printSeconds += TICK;
      this.jobSeconds += TICK;
      this.usageDirty = true;
    }
  }

  // ------------------------------------------------------------ state
  private update(print: PrintState) {
    deepMerge(this.state, print);
    this.trackJobs();
    this.emit('state', { state: this.state, connection: this.connection });
  }

  private setConnection(status: Connection['status'], error: string | null = null) {
    this.connection = { status, since: Date.now(), error };
    this.emit('state', { state: this.state, connection: this.connection });
  }

  private sampleTemps() {
    const s = this.state;
    if (s.nozzle_temper === undefined) return;
    this.tempHistory.push({ t: Date.now(), nozzle: s.nozzle_temper, nozzleTarget: s.nozzle_target_temper ?? 0, bed: s.bed_temper ?? 0, bedTarget: s.bed_target_temper ?? 0 });
    if (this.tempHistory.length > TEMP_HISTORY_MAX) this.tempHistory.shift();
  }

  private trackJobs() {
    const gs = this.state.gcode_state;
    const prev = this.lastGcodeState;
    if (gs && !['FINISH', 'FAILED', 'IDLE'].includes(gs) && typeof this.state.mc_percent === 'number') this.lastPercent = this.state.mc_percent;
    if (gs === prev) return;
    if ((gs === 'RUNNING' || gs === 'PREPARE') && !this.jobStartedAt) {
      this.jobStartedAt = Date.now();
      this.jobSeconds = 0;
      this.lastPercent = 0;
      this.jobFilament = null;
      this.emit('jobStarted', this.jobStartedAt);
    }
    const done = gs === 'FINISH' || gs === 'FAILED';
    const wasActive = prev && !['FINISH', 'FAILED', 'IDLE'].includes(prev);
    if (done && wasActive) {
      const job: PrintJob = {
        name: this.state.subtask_name || this.state.gcode_file || 'Unknown',
        result: gs as 'FINISH' | 'FAILED',
        layers: this.state.total_layer_num ?? null,
        started: this.jobStartedAt,
        ended: Date.now(),
        printSeconds: this.jobSeconds,
      };
      this.addFilament(job);
      // Listeners (project counting, energy) may annotate the job; async ones call saveHistory() later.
      this.emit('jobFinished', job);
      this.printHistory.unshift(job);
      this.printHistory = this.printHistory.slice(0, HISTORY_MAX);
      this.jobStartedAt = null;
      this.jobFilament = null;
      this.saveHistory();
      this.saveUsage();
    }
    this.lastGcodeState = gs;
  }

  /** Grams from the sliced file; a failed print only counts the part it got through. */
  private addFilament(job: PrintJob) {
    const f = this.jobFilament;
    if (!f) return;
    const share = job.result === 'FINISH' ? 1 : Math.min(1, Math.max(0, this.lastPercent / 100));
    const r = (n: number) => Math.round(n * share * 10) / 10;
    job.grams = r(f.grams);
    job.gramsSource = 'printer';
    const filaments = f.filaments.filter((x) => x.grams).map((x) => ({ type: x.type, color: x.color, grams: r(x.grams!) }));
    if (filaments.length) job.filaments = filaments;
  }

  // ------------------------------------------------------------ MQTT
  private publish(payload: object) {
    if (this.demo) return this.demoCommand(payload as any);
    if (!this.client?.connected) throw new Error('Not connected to the printer');
    this.client.publish(`device/${this.config!.serial}/request`, JSON.stringify(payload));
  }

  private startMqtt() {
    const { printerIp, serial, accessCode } = this.config!;
    const c = (this.client = mqtt.connect(`mqtts://${printerIp}:8883`, {
      username: 'bblp',
      password: accessCode,
      rejectUnauthorized: false, // the printer uses a self-signed certificate
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    }));
    c.on('connect', () => {
      this.setConnection('connected');
      c.subscribe(`device/${serial}/report`, (err) => {
        if (err) return this.setConnection('error', 'Subscribe failed: ' + err.message);
        this.publish({ pushing: { sequence_id: '0', command: 'pushall' } });
        setTimeout(() => c.connected && this.publish({ info: { sequence_id: '0', command: 'get_version' } }), 3000);
      });
    });
    c.on('message', (_t, buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.print) this.update(msg.print);
        if (msg.info?.module) { this.state.modules = msg.info.module; this.emit('state', { state: this.state, connection: this.connection }); }
      } catch { /* ignore unparseable messages */ }
    });
    c.on('error', (e) => this.setConnection('error', e.message));
    c.on('offline', () => this.setConnection('offline'));
    c.on('reconnect', () => this.setConnection('connecting'));
    // Re-request the full state occasionally. Not too often: P1/A1 printers don't like frequent pushall.
    setInterval(() => c.connected && this.publish({ pushing: { sequence_id: '0', command: 'pushall' } }), 5 * 60 * 1000);
  }

  /** Only these actions are allowed; arbitrary payloads are never forwarded to the printer. */
  command(action: string, value?: unknown) {
    const seq = String(Date.now());
    switch (action) {
      case 'pause':
      case 'resume':
      case 'stop':
        return this.publish({ print: { sequence_id: seq, command: action } });
      case 'speed': {
        const lvl = String(value);
        if (!['1', '2', '3', '4'].includes(lvl)) throw new Error('Invalid speed level');
        return this.publish({ print: { sequence_id: seq, command: 'print_speed', param: lvl } });
      }
      case 'light':
        return this.publish({ system: { sequence_id: seq, command: 'ledctrl', led_node: 'chamber_light', led_mode: value ? 'on' : 'off', led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } });
      case 'refresh':
        return this.publish({ pushing: { sequence_id: seq, command: 'pushall' } });
      default:
        throw new Error('Unknown action');
    }
  }

  // ------------------------------------------------------------ demo mode
  private d = { gs: 'RUNNING', pct: 37, layer: 84, spd: 2, light: 'on', nozzle: 25, bed: 22 };

  private demoCommand(p: { print?: { command: string; param?: string }; system?: { led_mode: string } }) {
    const d = this.d;
    if (p.print?.command === 'pause') d.gs = 'PAUSE';
    if (p.print?.command === 'resume') d.gs = 'RUNNING';
    if (p.print?.command === 'stop') d.gs = 'FAILED';
    if (p.print?.command === 'print_speed') d.spd = Number(p.print.param);
    if (p.system?.led_mode) d.light = p.system.led_mode;
  }

  private startDemo() {
    const d = this.d;
    const tick = () => {
      if (d.gs === 'RUNNING') { d.pct = Math.min(100, d.pct + 0.2); d.layer = Math.round(d.pct * 2.3); }
      if (d.pct >= 100) d.gs = 'FINISH';
      const heating = d.gs === 'RUNNING' || d.gs === 'PAUSE';
      d.nozzle += ((heating ? 220 : 26) - d.nozzle) * 0.15 + (Math.random() - 0.5);
      d.bed += ((heating ? 65 : 24) - d.bed) * 0.08 + (Math.random() - 0.5) * 0.4;
      this.update({
        gcode_state: d.gs, mc_percent: Math.floor(d.pct), mc_remaining_time: Math.round((100 - d.pct) * 1.8),
        layer_num: d.layer, total_layer_num: 230, subtask_name: 'Benchy_PLA_0.2mm', gcode_file: 'Benchy.gcode.3mf',
        nozzle_temper: +d.nozzle.toFixed(1), nozzle_target_temper: heating ? 220 : 0,
        bed_temper: +d.bed.toFixed(1), bed_target_temper: heating ? 65 : 0, chamber_temper: heating ? 34 : 24,
        spd_lvl: d.spd, spd_mag: [50, 100, 124, 166][d.spd - 1], stg_cur: d.gs === 'RUNNING' ? 0 : -1,
        cooling_fan_speed: heating ? '15' : '0', heatbreak_fan_speed: heating ? '15' : '0', big_fan1_speed: '7', big_fan2_speed: '4',
        wifi_signal: `-${48 + Math.round(Math.random() * 6)}dBm`, nozzle_diameter: '0.4', nozzle_type: 'hardened_steel',
        lights_report: [{ node: 'chamber_light', mode: d.light }], sdcard: true, print_error: 0, hms: [],
        ams: { tray_now: '1', ams: [
          { id: '0', humidity: '4', humidity_raw: '18', temp: '27.3', tray: [
            { id: '0', tray_type: 'PLA', tray_sub_brands: 'PLA Basic', tray_color: 'FFFFFFFF', remain: 80, nozzle_temp_min: '190', nozzle_temp_max: '230' },
            { id: '1', tray_type: 'PLA', tray_sub_brands: 'PLA Matte', tray_color: 'E4582AFF', remain: 45, nozzle_temp_min: '190', nozzle_temp_max: '230' },
            { id: '2', tray_type: 'PETG', tray_sub_brands: 'PETG HF', tray_color: '1F2A44FF', remain: -1, nozzle_temp_min: '230', nozzle_temp_max: '260' },
            { id: '3' },
          ] },
        ] },
        vt_tray: { id: '254', tray_type: '', tray_color: '00000000' },
      });
    };
    for (let i = 360; i > 0; i--) {
      this.tempHistory.push({ t: Date.now() - i * 5000, nozzle: 220 + Math.sin(i / 9), nozzleTarget: 220, bed: 65 + Math.sin(i / 20) * 0.4, bedTarget: 65 });
    }
    d.nozzle = 220; d.bed = 65;
    tick();
    setInterval(tick, 2000);
  }
}

// One instance per process, even when Next.js reloads modules (hot reload in dev).
const g = globalThis as unknown as { __bambuPrinter?: Printer };
export function getPrinter(): Printer {
  return (g.__bambuPrinter ??= new Printer());
}
