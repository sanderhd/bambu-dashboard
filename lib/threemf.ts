// Reads the preview image and slicing info from a 3MF file (a ZIP archive) without loading
// the whole file: only the central directory and the few entries we need are read from disk.
import 'server-only';
import fs from 'fs';
import { extract, listEntries } from './zip';
import type { SliceInfo } from './types';

const attr = (tag: string, key: string) => tag.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];

type Plate = { index: number | null; seconds: number | null; grams: number | null; filaments: SliceInfo['filaments'] };

/** Parses Bambu Studio / OrcaSlicer's Metadata/slice_info.config: one entry per sliced plate. */
function parsePlates(xml: string): Plate[] {
  return (xml.match(/<plate>[\s\S]*?<\/plate>/g) ?? []).map((plate) => {
    const meta = (key: string) => {
      const tag = plate.match(new RegExp(`<metadata[^>]*key="${key}"[^>]*/?>`))?.[0];
      return tag ? attr(tag, 'value') : undefined;
    };
    const t = Number(meta('prediction')), w = Number(meta('weight')), i = Number(meta('index'));
    const filaments = (plate.match(/<filament\b[^>]*\/?>/g) ?? []).map((tag) => {
      const g = Number(attr(tag, 'used_g'));
      return { type: attr(tag, 'type') ?? '', color: attr(tag, 'color') ?? '', grams: Number.isFinite(g) ? g : null };
    });
    return {
      index: Number.isInteger(i) && i > 0 ? i : null,
      seconds: Number.isFinite(t) && t > 0 ? t : null,
      grams: Number.isFinite(w) && w > 0 ? w : null,
      filaments,
    };
  });
}

function parseSliceInfo(xml: string): SliceInfo | null {
  const plates = parsePlates(xml);
  if (!plates.length) return null;
  const timed = plates.filter((p) => p.seconds != null), weighed = plates.filter((p) => p.grams != null);
  return {
    plates: plates.length,
    minutes: timed.length ? Math.round(timed.reduce((n, p) => n + p.seconds!, 0) / 60) : null,
    grams: weighed.length ? Math.round(weighed.reduce((n, p) => n + p.grams!, 0) * 10) / 10 : null,
    filaments: plates.flatMap((p) => p.filaments),
  };
}

/**
 * Filament use of one plate of a sliced .3mf, as the slicer predicted it. `plate` is the plate
 * being printed (1-based); unknown or missing falls back to the first plate, like Bambu Studio.
 */
export function plateUsage(file: string, plate: number | null): { plate: number | null; grams: number; filaments: SliceInfo['filaments'] } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const entry = listEntries(fd, fs.fstatSync(fd).size).find((e) => e.name.replace(/^\//, '').toLowerCase() === 'metadata/slice_info.config');
    if (!entry) return null;
    const plates = parsePlates(extract(fd, entry).toString('utf8'));
    const p = (plate != null && plates.find((x) => x.index === plate)) || plates[0];
    if (!p) return null;
    const fromFilaments = p.filaments.reduce((n, f) => n + (f.grams ?? 0), 0);
    const grams = p.grams ?? (fromFilaments > 0 ? fromFilaments : null);
    if (grams == null) return null;
    return { plate: p.index, grams: Math.round(grams * 10) / 10, filaments: p.filaments.filter((f) => f.grams) };
  } catch (e) {
    console.warn('[3mf]', (e as Error).message);
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
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
