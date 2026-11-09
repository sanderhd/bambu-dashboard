// Camera sources, all exposed as a stream of JPEG frames:
// - printer: A1/P1 JPEG stream over TLS on port 6000, or X1/H2 RTSP via ffmpeg
// - mjpeg:   any HTTP MJPEG stream or JPEG snapshot URL (e.g. a USB webcam served by picam/mjpg-streamer)
// A source only runs while someone is watching it.
import 'server-only';
import { EventEmitter } from 'events';
import { spawn, spawnSync } from 'child_process';
import tls from 'tls';
import { getPrinter } from './printer';
import { getSettings, settingsEvents } from './settings';
import type { CameraConfig, CameraInfo } from './types';

const CONNECT_TIMEOUT = 10_000;
const FIRST_FRAME_TIMEOUT = 15_000;
const STALL_TIMEOUT = 20_000;
const RETRY_DELAY = 5_000;
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** Splits a byte stream into JPEG images by their start/end markers. */
function jpegSplitter(onFrame: (jpg: Buffer) => void) {
  let buf: Buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const start = buf.indexOf(SOI);
      if (start < 0) { buf = Buffer.alloc(0); return; }
      const end = buf.indexOf(EOI, start + 2);
      if (end < 0) { buf = buf.subarray(start); break; }
      onFrame(Buffer.from(buf.subarray(start, end + 2)));
      buf = buf.subarray(end + 2);
    }
    if (buf.length > 8_000_000) buf = Buffer.alloc(0);
  };
}

abstract class CameraSource extends EventEmitter {
  lastFrame: Buffer | null = null;
  lastFrameAt = 0;
  error: string | null = null;
  private viewers = 0;
  private running = false;
  private watchdog: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;

  constructor(readonly info: CameraInfo) { super(); this.setMaxListeners(50); }

  /** Why this camera can't be used at all, or null. */
  unavailableReason(): string | null { return null; }
  protected abstract open(): void;
  protected abstract close(): void;

  watch(onFrame: (jpg: Buffer) => void, onFail: (msg: string) => void) {
    this.on('frame', onFrame);
    this.on('failed', onFail);
    this.viewers++;
    if (!this.running && !this.retry) this.start();
    return () => {
      this.off('frame', onFrame);
      this.off('failed', onFail);
      this.viewers--;
      setTimeout(() => { if (this.viewers <= 0) this.shutdown(); }, 2000);
    };
  }

  private start() {
    this.retry = null;
    this.running = true;
    this.armWatchdog(FIRST_FRAME_TIMEOUT, `No image received from ${this.info.name}`);
    try { this.open(); } catch (e) { this.fail((e as Error).message); }
  }

  private armWatchdog(ms: number, msg: string) {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail(msg), ms);
  }

  protected frame(jpg: Buffer) {
    this.error = null;
    this.lastFrame = jpg;
    this.lastFrameAt = Date.now();
    this.armWatchdog(STALL_TIMEOUT, `${this.info.name} stopped sending images`);
    this.emit('frame', jpg);
  }

  /** Stops the source with an error; retries while people are still watching. */
  protected fail(msg: string) {
    if (!this.running) return;
    console.warn(`[camera:${this.info.id}] ${msg}`);
    this.error = msg;
    this.stopInternal();
    this.emit('failed', msg);
    if (this.viewers > 0) this.retry = setTimeout(() => this.start(), RETRY_DELAY);
  }

  /** The underlying connection ended without an explicit error. */
  protected ended(msg: string) { this.fail(msg); }

  private stopInternal() {
    this.running = false;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    try { this.close(); } catch { /* already closed */ }
  }

  shutdown() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.running) this.stopInternal();
  }
}

// ---------------------------------------------------------------- printer: A1 / P1 (port 6000)
class PrinterJpegSource extends CameraSource {
  private sock: tls.TLSSocket | null = null;

  unavailableReason() {
    const p = getPrinter();
    return p.demo ? 'No printer camera in demo mode' : null;
  }

  protected open() {
    const { printerIp, accessCode } = getPrinter().config!;
    const auth = Buffer.alloc(80);
    auth.writeUInt32LE(0x40, 0);
    auth.writeUInt32LE(0x3000, 4);
    auth.write('bblp', 16, 'ascii');
    auth.write(accessCode, 48, 'ascii');

    let buf = Buffer.alloc(0);
    let frames = 0;
    const sock = (this.sock = tls.connect({ host: printerIp, port: 6000, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT }, () => {
      sock.setTimeout(0);
      sock.write(auth);
    }));
    sock.on('timeout', () => this.fail(
      'Can\'t reach the printer camera (port 6000). On the printer, turn on "LAN Only Liveview" in the network settings.'));
    sock.on('error', (e: NodeJS.ErrnoException) => this.fail(
      e.code === 'ECONNREFUSED'
        ? 'The printer refused the camera connection. Turn on "LAN Only Liveview" in the printer\'s network settings.'
        : `Printer camera error: ${e.message}`));
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 16) {
        const size = buf.readUInt32LE(0);
        if (size <= 0 || size > 5_000_000) { buf = Buffer.alloc(0); break; }
        if (buf.length < 16 + size) break;
        const jpg = Buffer.from(buf.subarray(16, 16 + size));
        buf = buf.subarray(16 + size);
        if (jpg[0] === 0xff && jpg[1] === 0xd8) { frames++; this.frame(jpg); }
      }
    });
    sock.on('close', () => this.ended(frames
      ? 'The printer closed the camera connection'
      : 'The printer closed the camera connection right away. Check the access code, and that "LAN Only Liveview" is on.'));
  }

  protected close() { this.sock?.destroy(); this.sock = null; }
}

// ---------------------------------------------------------------- printer: X1 / H2 (RTSPS via ffmpeg)
let ffmpegAvailable: boolean | undefined;
const hasFfmpeg = () => (ffmpegAvailable ??= spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0);

class PrinterRtspSource extends CameraSource {
  private ff: ReturnType<typeof spawn> | null = null;

  unavailableReason() {
    const p = getPrinter();
    if (p.demo) return 'No printer camera in demo mode';
    if (!hasFfmpeg()) return `The ${p.info.model} camera needs ffmpeg. Install it (Docker: set INSTALL_FFMPEG to "true").`;
    return null;
  }

  protected open() {
    const { printerIp, accessCode } = getPrinter().config!;
    const url = `rtsps://bblp:${encodeURIComponent(accessCode)}@${printerIp}:322/streaming/live/1`;
    const ff = (this.ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url,
      '-an', '-f', 'mjpeg', '-q:v', '5', '-r', '10', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] }));
    let lastErr = '';
    ff.stdout!.on('data', jpegSplitter((jpg) => this.frame(jpg)));
    ff.stderr!.on('data', (d) => { lastErr = String(d).trim().replaceAll(accessCode, '***'); });
    ff.on('error', (e) => this.fail(`ffmpeg: ${e.message}`));
    ff.on('close', () => this.ended(lastErr ? `Printer camera: ${lastErr}` : 'Printer camera stream ended'));
  }

  protected close() { this.ff?.kill(); this.ff = null; }
}

// ---------------------------------------------------------------- HTTP MJPEG stream / JPEG snapshot
class MjpegUrlSource extends CameraSource {
  private abort: AbortController | null = null;
  private poll: NodeJS.Timeout | null = null;

  constructor(readonly cfg: CameraConfig) {
    super({ id: cfg.id, name: cfg.name, type: 'mjpeg' });
  }

  protected open() {
    const ac = (this.abort = new AbortController());
    const connectTimer = setTimeout(() => ac.abort(new Error('timeout')), CONNECT_TIMEOUT);
    fetch(this.cfg.url, { signal: ac.signal, cache: 'no-store' }).then(async (res) => {
      clearTimeout(connectTimer);
      if (!res.ok) return this.fail(`${this.cfg.name}: the camera answered HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (type.startsWith('image/')) {
        // Snapshot URL: show this image, then fetch a new one every second.
        this.frame(Buffer.from(await res.arrayBuffer()));
        this.poll = setTimeout(() => { if (this.abort === ac) this.open(); }, 1000);
        return;
      }
      if (!res.body) return this.fail(`${this.cfg.name}: empty response`);
      const split = jpegSplitter((jpg) => this.frame(jpg));
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return this.ended(`${this.cfg.name}: the stream ended`);
        split(Buffer.from(value));
      }
    }).catch((e) => {
      clearTimeout(connectTimer);
      if (this.abort !== ac) return; // closed on purpose
      const cause = (e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(e)) as string;
      this.fail(`Can't reach ${this.cfg.name} at ${this.cfg.url} (${cause})`);
    });
  }

  protected close() {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
    const ac = this.abort;
    this.abort = null;
    ac?.abort();
  }
}

/** Fetches a URL once to check that it serves a camera image or stream. */
export async function probeCameraUrl(url: string): Promise<{ ok: boolean; message: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), CONNECT_TIMEOUT);
  try {
    const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    const type = res.headers.get('content-type') ?? 'unknown';
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    let result = { ok: false, message: `Not a camera stream (content type: ${type})` };
    if (type.startsWith('image/')) result = { ok: true, message: 'JPEG snapshot, refreshed every second' };
    else if (type.startsWith('multipart/')) result = { ok: true, message: 'MJPEG stream' };
    await res.body?.cancel();
    return result;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return { ok: false, message: ac.signal.aborted ? 'No answer within 10 seconds' : err.cause?.code ?? err.message };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- registry
class CameraHub {
  private sources = new Map<string, CameraSource>();

  constructor() {
    settingsEvents.on('change', () => {
      // Drop sources whose configuration changed or was removed; they are recreated on demand.
      const wanted = new Map(this.list().map((c) => [c.id, c]));
      for (const [id, src] of this.sources) {
        const cfg = getSettings().cameras.find((c) => c.id === id);
        const stale = id !== 'printer' && (!wanted.has(id) || (src instanceof MjpegUrlSource && JSON.stringify(cfg) !== JSON.stringify(src.cfg)));
        if (stale) { src.shutdown(); src.emit('failed', 'This camera was changed or removed'); this.sources.delete(id); }
      }
    });
  }

  list(): CameraInfo[] {
    const p = getPrinter();
    const cams: CameraInfo[] = [];
    if (p.info.camera !== 'off') cams.push({ id: 'printer', name: 'Printer camera', type: 'printer' });
    for (const c of getSettings().cameras) cams.push({ id: c.id, name: c.name, type: 'mjpeg' });
    return cams;
  }

  get(id: string): CameraSource | null {
    const existing = this.sources.get(id);
    if (existing) return existing;
    let src: CameraSource | null = null;
    if (id === 'printer') {
      const p = getPrinter();
      if (p.info.camera === 'off') return null;
      const info: CameraInfo = { id, name: 'Printer camera', type: 'printer' };
      src = p.info.camera === 'rtsp' ? new PrinterRtspSource(info) : new PrinterJpegSource(info);
    } else {
      const cfg = getSettings().cameras.find((c) => c.id === id);
      if (cfg) src = new MjpegUrlSource(cfg);
    }
    if (src) this.sources.set(id, src);
    return src;
  }

  /** One current JPEG from a camera (starting it briefly if nobody is watching), or null. */
  snapshot(id: string, timeoutMs = 15_000): Promise<Buffer | null> {
    const src = this.get(id);
    if (!src || src.unavailableReason()) return Promise.resolve(null);
    if (src.lastFrame && Date.now() - src.lastFrameAt < 3000) return Promise.resolve(src.lastFrame);
    return new Promise((resolve) => {
      let unwatch: (() => void) | null = null;
      let settled = false;
      const done = (jpg: Buffer | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unwatch?.();
        resolve(jpg);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      unwatch = src.watch((jpg) => done(jpg), () => done(null));
      if (settled) unwatch(); // failed straight away, inside watch()
    });
  }
}

const g = globalThis as unknown as { __bambuCameras?: CameraHub };
export const getCameraHub = () => (g.__bambuCameras ??= new CameraHub());
