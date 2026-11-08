// Reads the preview image and slicing info from a 3MF file (a ZIP archive) without loading
// the whole file: only the central directory and the few entries we need are read from disk.
import 'server-only';
import fs from 'fs';
import zlib from 'zlib';
import type { SliceInfo } from './types';

type Entry = { name: string; method: number; compSize: number; size: number; offset: number };
const MAX_ENTRY = 20 * 1024 * 1024; // never inflate more than this per entry

function readAt(fd: number, pos: number, len: number) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

function listEntries(fd: number, fileSize: number): Entry[] {
  // End-of-central-directory record: within the last 64 KB (+22 bytes).
  const tailLen = Math.min(fileSize, 65_557);
  const tail = readAt(fd, fileSize - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP file');
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);

  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    // ZIP64: the locator sits right before the EOCD and points at the ZIP64 EOCD record.
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('Broken ZIP64 archive');
    const z64 = readAt(fd, Number(tail.readBigUInt64LE(loc + 8)), 56);
    if (z64.readUInt32LE(0) !== 0x06064b50) throw new Error('Broken ZIP64 archive');
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  if (cdSize > 16 * 1024 * 1024) throw new Error('ZIP directory too large');

  const cd = readAt(fd, cdOffset, cdSize);
  const entries: Entry[] = [];
  for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    const e: Entry = {
      method: cd.readUInt16LE(p + 10),
      compSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
    };
    // ZIP64 extra field (0x0001) holds the real values for fields set to 0xffffffff, in this order.
    for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (e.size === 0xffffffff) { e.size = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (e.compSize === 0xffffffff) { e.compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (e.offset === 0xffffffff) { e.offset = Number(cd.readBigUInt64LE(q)); }
      }
      x += 4 + len;
    }
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(fd: number, e: Entry): Buffer {
  if (e.size > MAX_ENTRY || e.compSize > MAX_ENTRY) throw new Error(`${e.name} is too large`);
  const local = readAt(fd, e.offset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Broken ZIP entry');
  const start = e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const data = readAt(fd, start, e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
  throw new Error(`Unsupported compression in ${e.name}`);
}

const attr = (tag: string, key: string) => tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];

/** Parses Bambu Studio / OrcaSlicer's Metadata/slice_info.config. */
function parseSliceInfo(xml: string): SliceInfo | null {
  const plates = xml.match(/<plate>[\s\S]*?<\/plate>/g) ?? [];
  if (!plates.length) return null;
  let seconds = 0, grams = 0, haveTime = false, haveGrams = false;
  const filaments: SliceInfo['filaments'] = [];
  for (const plate of plates) {
    const meta = (key: string) => {
      const tag = plate.match(new RegExp(`<metadata[^>]*key="${key}"[^>]*/?>`))?.[0];
      return tag ? attr(tag, 'value') : undefined;
    };
    const t = Number(meta('prediction')), w = Number(meta('weight'));
    if (Number.isFinite(t) && t > 0) { seconds += t; haveTime = true; }
    if (Number.isFinite(w) && w > 0) { grams += w; haveGrams = true; }
    for (const tag of plate.match(/<filament\b[^>]*\/?>/g) ?? []) {
      const g = Number(attr(tag, 'used_g'));
      filaments.push({ type: attr(tag, 'type') ?? '', color: attr(tag, 'color') ?? '', grams: Number.isFinite(g) ? g : null });
    }
  }
  return {
    plates: plates.length,
    minutes: haveTime ? Math.round(seconds / 60) : null,
    grams: haveGrams ? Math.round(grams * 10) / 10 : null,
    filaments,
  };
}

/** Preview PNG and (for sliced files) slicing info. Never throws: a broken file just has neither. */
export function inspect3mf(file: string): { thumbnail: Buffer | null; slice: SliceInfo | null } {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const entries = listEntries(fd, fs.fstatSync(fd).size);
    const byName = new Map(entries.map((e) => [e.name.replace(/^\//, '').toLowerCase(), e]));
    // Bambu/Orca: Metadata/plate_1.png. Generic 3MF: Metadata/thumbnail.png.
    const thumbEntry = byName.get('metadata/plate_1.png') ?? byName.get('metadata/thumbnail.png')
      ?? entries.find((e) => /^\/?metadata\/[^/]+\.png$/i.test(e.name) && !/_small|pick_|top_/i.test(e.name));
    let thumbnail: Buffer | null = null;
    if (thumbEntry) {
      const png = extract(fd, thumbEntry);
      if (png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) thumbnail = png;
    }
    const sliceEntry = byName.get('metadata/slice_info.config');
    const slice = sliceEntry ? parseSliceInfo(extract(fd, sliceEntry).toString('utf8')) : null;
    return { thumbnail, slice };
  } catch (e) {
    console.warn('[3mf]', (e as Error).message);
    return { thumbnail: null, slice: null };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
