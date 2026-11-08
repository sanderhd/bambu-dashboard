// Server-only: a single connection to the printer (MQTT + camera), shared by all API routes.
// Runs in the Next.js Node.js runtime; works with `next dev` and `next start` (not serverless).
import 'server-only';
import { EventEmitter } from 'events';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import tls from 'tls';
import mqtt, { MqttClient } from 'mqtt';
import type { CameraMode, Connection, PrintState, PrintJob, PrinterInfo, TempSample, Snapshot } from './types';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'print-history.json');
const TEMP_HISTORY_MAX = (60 * 60) / 5; // 1 hour at one sample every 5 s

type Config = { printerIp: string; serial: string; accessCode: string; name?: string; camera?: CameraMode | 'auto' };

function loadConfig(): Config | null {
  if (process.env.BAMBU_DEMO === '1') return null;
  const env = process.env;
  if (env.BAMBU_IP && env.BAMBU_SERIAL && env.BAMBU_ACCESS_CODE) {
    return {
      printerIp: env.BAMBU_IP, serial: env.BAMBU_SERIAL, accessCode: env.BAMBU_ACCESS_CODE,
      name: env.BAMBU_NAME, camera: env.BAMBU_CAMERA as Config['camera'],
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
  private client: MqttClient | null = null;
  private lastGcodeState?: string;
  private jobStartedAt: number | null = null;

  constructor() {
    super();
    this.setMaxListeners(100);
    try { this.printHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch { /* none yet */ }
    setInterval(() => this.sampleTemps(), 5000);
    if (this.demo) this.startDemo(); else this.startMqtt();
  }

  snapshot(): Snapshot {
    return {
      state: this.state, connection: this.connection, tempHistory: this.tempHistory,
      printHistory: this.printHistory, demo: this.demo, printer: this.info,
    };
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
    if (gs === prev) return;
    if ((gs === 'RUNNING' || gs === 'PREPARE') && !this.jobStartedAt) this.jobStartedAt = Date.now();
    const done = gs === 'FINISH' || gs === 'FAILED';
    const wasActive = prev && !['FINISH', 'FAILED', 'IDLE'].includes(prev);
    if (done && wasActive) {
      this.printHistory.unshift({
        name: this.state.subtask_name || this.state.gcode_file || 'Unknown',
        result: gs as 'FINISH' | 'FAILED',
        layers: this.state.total_layer_num ?? null,
        started: this.jobStartedAt,
        ended: Date.now(),
      });
      this.printHistory = this.printHistory.slice(0, 100);
      fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
      fs.writeFile(HISTORY_PATH, JSON.stringify(this.printHistory, null, 2), () => {});
      this.jobStartedAt = null;
      this.emit('history', this.printHistory);
    }
    this.lastGcodeState = gs;
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

  // ------------------------------------------------------------ camera
  // A1/P1: JPEG frames over TLS on port 6000.
  // X1/H2: RTSPS on port 322, converted to JPEG frames with ffmpeg (must be installed).
  private camSource: { stop(): void } | null = null;
  private camViewers = 0;
  lastFrame: Buffer | null = null;

  /** Why the camera can't be used, or null when it can. */
  cameraUnavailableReason(): string | null {
    if (this.demo) return 'No camera in demo mode';
    if (this.info.camera === 'off') return 'Camera is turned off in the configuration';
    if (this.info.camera === 'rtsp' && !hasFfmpeg()) return `The ${this.info.model} camera needs ffmpeg. Install it and make sure it is on your PATH.`;
    return null;
  }

  /** Register a viewer; returns an unsubscribe function. */
  watchCamera(onFrame: (jpg: Buffer) => void) {
    const reason = this.cameraUnavailableReason();
    if (reason) throw new Error(reason);
    this.on('frame', onFrame);
    this.camViewers++;
    this.startCamera();
    return () => {
      this.off('frame', onFrame);
      this.camViewers--;
      setTimeout(() => { if (this.camViewers <= 0 && this.camSource) { this.camSource.stop(); this.camSource = null; } }, 2000);
    };
  }

  private frame(jpg: Buffer) {
    this.lastFrame = jpg;
    this.emit('frame', jpg);
  }

  private startCamera() {
    if (this.camSource) return;
    const onClosed = () => {
      this.camSource = null;
      if (this.camViewers > 0) setTimeout(() => this.startCamera(), 3000);
    };
    this.camSource = this.info.camera === 'rtsp' ? this.startRtspCamera(onClosed) : this.startJpegCamera(onClosed);
  }

  private startJpegCamera(onClosed: () => void) {
    const { printerIp, accessCode } = this.config!;
    const auth = Buffer.alloc(80);
    auth.writeUInt32LE(0x40, 0);
    auth.writeUInt32LE(0x3000, 4);
    auth.write('bblp', 16, 'ascii');
    auth.write(accessCode, 48, 'ascii');

    let buf = Buffer.alloc(0);
    let stopped = false;
    const sock: tls.TLSSocket = tls.connect({ host: printerIp, port: 6000, rejectUnauthorized: false }, () => sock.write(auth));
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 16) {
        const size = buf.readUInt32LE(0);
        if (size <= 0 || size > 5_000_000) { buf = Buffer.alloc(0); break; }
        if (buf.length < 16 + size) break;
        const jpg = Buffer.from(buf.subarray(16, 16 + size));
        buf = buf.subarray(16 + size);
        if (jpg[0] === 0xff && jpg[1] === 0xd8) this.frame(jpg);
      }
    });
    sock.on('error', (e) => console.warn('[camera]', e.message));
    sock.on('close', () => { if (!stopped) onClosed(); });
    return { stop: () => { stopped = true; sock.destroy(); } };
  }

  private startRtspCamera(onClosed: () => void) {
    const { printerIp, accessCode } = this.config!;
    const url = `rtsps://bblp:${encodeURIComponent(accessCode)}@${printerIp}:322/streaming/live/1`;
    let stopped = false;
    const ff: ChildProcess = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url,
      '-an', '-f', 'mjpeg', '-q:v', '5', '-r', '10', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = Buffer.alloc(0);
    ff.stdout!.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) { buf = Buffer.alloc(0); break; }
        const end = buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) { buf = buf.subarray(start); break; }
        this.frame(Buffer.from(buf.subarray(start, end + 2)));
        buf = buf.subarray(end + 2);
      }
      if (buf.length > 10_000_000) buf = Buffer.alloc(0);
    });
    ff.stderr!.on('data', (d) => console.warn('[camera/ffmpeg]', String(d).trim().replaceAll(accessCode, '***')));
    ff.on('error', (e) => console.warn('[camera/ffmpeg]', e.message));
    ff.on('close', () => { if (!stopped) onClosed(); });
    return { stop: () => { stopped = true; ff.kill(); } };
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

let ffmpegChecked: boolean | undefined;
function hasFfmpeg() {
  if (ffmpegChecked === undefined) {
    ffmpegChecked = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  }
  return ffmpegChecked;
}

// One instance per process, even when Next.js reloads modules (hot reload in dev).
const g = globalThis as unknown as { __bambuPrinter?: Printer };
export function getPrinter(): Printer {
  return (g.__bambuPrinter ??= new Printer());
}
