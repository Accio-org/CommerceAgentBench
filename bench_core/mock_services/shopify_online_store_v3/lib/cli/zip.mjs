// Minimal STORE-only (no DEFLATE) ZIP writer — enough to package a theme
// directory for `shopify theme package`.
//
// Why pure-JS rather than `spawnSync('zip', …)`?  Bun runs everywhere our
// mock runs (macOS / debian-slim / alpine) but `zip` is not in every Linux
// base image (alpine ships without it). A 60-line stored-only writer keeps
// the command self-contained and produces a perfectly valid ZIP that any
// reader unpacks unmodified.
//
// Format reference: APPNOTE 6.3 sections 4.3.6 (local header), 4.3.12
// (central directory), 4.3.16 (end-of-central-directory).

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Returns { time, date } as DOS-format 16-bit ints for the given Date.
function dosTimeDate(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const year = d.getFullYear();
  const safeYear = year < 1980 ? 1980 : year;
  const date = (((safeYear - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

// entries: [{ name: string, data: Buffer, mtime?: Date }]
export function buildZipBuffer(entries) {
  const localChunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const { time, date } = dosTimeDate(entry.mtime || new Date());
    // Local file header
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);   // signature
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0x0800, 6);        // gpf — bit 11 (utf-8 names)
    lh.writeUInt16LE(0, 8);             // compression method = stored
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);  // compressed
    lh.writeUInt32LE(data.length, 22);  // uncompressed
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);            // extra field length
    localChunks.push(lh, nameBuf, data);

    // Central directory entry
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);    // signature
    cd.writeUInt16LE(0x031e, 4);        // version made by (UNIX, v3.0)
    cd.writeUInt16LE(20, 6);            // version needed
    cd.writeUInt16LE(0x0800, 8);        // gpf
    cd.writeUInt16LE(0, 10);            // compression = stored
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);            // extra length
    cd.writeUInt16LE(0, 32);            // comment length
    cd.writeUInt16LE(0, 34);            // disk number
    cd.writeUInt16LE(0, 36);            // internal attrs
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs (regular file 0644, UNIX)
    cd.writeUInt32LE(offset, 42);       // local header offset
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + data.length;
  }

  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

// Walk a directory and write a zip of every file under it. `includePrefixes`
// (optional array of top-level dir names) gates which top-level entries are
// included — used by `theme package` to honor real CLI's behavior of only
// zipping standard Shopify theme dirs.
export function zipDirectory(srcDir, outPath, { includePrefixes = null, includeListing = false } = {}) {
  const files = [];
  walk(srcDir, '');
  files.sort((a, b) => a.name.localeCompare(b.name));
  const entries = files.map((f) => ({
    name: f.name,
    data: readFileSync(f.abs),
    mtime: f.mtime,
  }));
  const buf = buildZipBuffer(entries);
  writeFileSync(outPath, buf);
  return { fileCount: entries.length, byteSize: buf.length };

  function walk(absDir, relDir) {
    let dirents;
    try { dirents = readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue;
      if (d.name === 'node_modules') continue;
      const abs = join(absDir, d.name);
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      if (d.isDirectory()) {
        // Only descend into recognized theme dirs (and `listings` if requested)
        if (!relDir) {
          if (includePrefixes && !includePrefixes.includes(d.name)) {
            if (!(includeListing && d.name === 'listings')) continue;
          }
        }
        walk(abs, rel);
      } else if (d.isFile()) {
        // Top-level files only included if no prefix gating is active.
        if (!relDir && includePrefixes) continue;
        let mtime;
        try { mtime = statSync(abs).mtime; } catch { mtime = undefined; }
        files.push({ abs, name: rel, mtime });
      }
    }
  }
}
