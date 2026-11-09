// Minimal ZIP reading and writing, without loading whole archives into memory.
// Reading: only the central directory and the entries we need are read from disk (3MF files, backups).
// Writing: a streaming ZIP with ZIP64 offsets, so a backup of several GB works on a Raspberry Pi.
import 'server-only';
import fs from 'fs';
import { PassThrough, Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';

export type Entry = { name: string; method: number; crc: number; compSize: number; size: number; offset: number };
const MAX_ENTRY = 20 * 1024 * 1024; // never inflate more than this into memory per entry

function readAt(fd: number, pos: number, len: number) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

export function listEntries(fd: number, fileSize: number): Entry[] {
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
      crc: cd.readUInt32LE(p + 16),
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

/** Where the entry's (compressed) data starts: after the local header, whose extra field may differ from the central one. */
function dataStart(fd: number, e: Entry) {
  const local = readAt(fd, e.offset, 30);
  if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) throw new Error('Broken ZIP entry');
  return e.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
}

/** Reads one small entry into memory. */
export function extract(fd: number, e: Entry): Buffer {
  if (e.size > MAX_ENTRY || e.compSize > MAX_ENTRY) throw new Error(`${e.name} is too large`);
  const data = readAt(fd, dataStart(fd, e), e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
  throw new Error(`Unsupported compression in ${e.name}`);
}

/** Streams one entry of any size to a file, checking its size and CRC. */
export async function extractToFile(fd: number, zipPath: string, e: Entry, dest: string) {
  if (e.method !== 0 && e.method !== 8) throw new Error(`Unsupported compression in ${e.name}`);
  const start = dataStart(fd, e);
  let crc = 0, size = 0;
  const check = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      crc = zlib.crc32(chunk, crc);
      size += chunk.length;
      if (size > e.size) return cb(new Error(`${e.name} is larger than its ZIP header says`));
      cb(null, chunk);
    },
  });
  const raw = e.compSize ? fs.createReadStream(zipPath, { start, end: start + e.compSize - 1 }) : Readable.from([]);
  const out = fs.createWriteStream(dest);
  if (e.method === 8) await pipeline(raw, zlib.createInflateRaw(), check, out);
  else await pipeline(raw, check, out);
  if (size !== e.size || (crc >>> 0) !== e.crc) throw new Error(`${e.name} is damaged (checksum mismatch)`);
}

// ---------------------------------------------------------------- writing

export type ZipSource = { name: string; mtime: Date } & ({ path: string } | { data: Buffer });

// Already-compressed formats are stored as is; deflating them again only costs CPU.
const STORE = /\.(3mf|png|jpe?g|webp|zip|gz)$/i;
const LIMIT32 = 0xffffffff;

function dosDateTime(d: Date) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Builds a ZIP archive as a stream of chunks. Entries use data descriptors (sizes and CRC
 * after the data), so files are read only once. Single entries must stay under 4 GB; the
 * archive itself may be larger (ZIP64 offsets).
 */
export async function* zipStream(sources: Iterable<ZipSource>): AsyncGenerator<Buffer> {
  let offset = 0;
  const central: Buffer[] = [];
  let count = 0;

  for (const src of sources) {
    const name = Buffer.from(src.name, 'utf8');
    const method = STORE.test(src.name) ? 0 : 8;
    const { time, date } = dosDateTime(src.mtime);
    const flags = 0x0808; // bit 3: data descriptor follows; bit 11: UTF-8 file name

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // CRC and sizes (14–25) stay 0: they are in the data descriptor.
    local.writeUInt16LE(name.length, 26);
    const headerOffset = offset;
    yield local; yield name;
    offset += 30 + name.length;

    let crc = 0, size = 0, compSize = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) { crc = zlib.crc32(chunk, crc); size += chunk.length; cb(null, chunk); },
    });
    const input = 'data' in src ? Readable.from([src.data]) : fs.createReadStream(src.path, { highWaterMark: 256 * 1024 });
    const out = method === 8 ? zlib.createDeflateRaw({ level: 6 }) : new PassThrough();
    const done = pipeline(input, tap, out);
    done.catch(() => {}); // a failure also ends the loop below with the error; this only avoids an unhandled rejection
    for await (const chunk of out as AsyncIterable<Buffer>) { compSize += chunk.length; yield chunk; }
    await done;
    if (size >= LIMIT32 || compSize >= LIMIT32) throw new Error(`${src.name} is too large for a backup entry`);
    offset += compSize;

    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(compSize, 8);
    desc.writeUInt32LE(size, 12);
    yield desc;
    offset += 16;

    const zip64 = headerOffset >= LIMIT32;
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(zip64 ? 45 : 20, 4); // version made by
    cd.writeUInt16LE(zip64 ? 45 : 20, 6); // version needed
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(compSize, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(zip64 ? 12 : 0, 30); // extra field length
    cd.writeUInt32LE(zip64 ? LIMIT32 : headerOffset, 42);
    const parts = [cd, name];
    if (zip64) {
      const extra = Buffer.alloc(12);
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(8, 2);
      extra.writeBigUInt64LE(BigInt(headerOffset), 4);
      parts.push(extra);
    }
    central.push(Buffer.concat(parts));
    count++;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of central) { yield c; cdSize += c.length; }

  const needZip64 = cdOffset >= LIMIT32 || count >= 0xffff;
  if (needZip64) {
    const z64 = Buffer.alloc(56);
    z64.writeUInt32LE(0x06064b50, 0);
    z64.writeBigUInt64LE(44n, 4); // size of the rest of this record
    z64.writeUInt16LE(45, 12);
    z64.writeUInt16LE(45, 14);
    z64.writeBigUInt64LE(BigInt(count), 24);
    z64.writeBigUInt64LE(BigInt(count), 32);
    z64.writeBigUInt64LE(BigInt(cdSize), 40);
    z64.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
    loc.writeUInt32LE(1, 16); // total number of disks
    yield z64; yield loc;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(needZip64 ? 0xffff : count, 8);
  eocd.writeUInt16LE(needZip64 ? 0xffff : count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(needZip64 ? LIMIT32 : cdOffset, 16);
  yield eocd;
}
