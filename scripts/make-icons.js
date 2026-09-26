// Generates icons/icon{16,32,48,128}.png without dependencies: dark rounded tile,
// two white "text lines" and one yellow highlighted line in between.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [37, 38, 43];
const WHITE = [241, 243, 245];
const YELLOW = [255, 212, 59];

// Signed distance to a rounded rectangle centred at (cx, cy) with half-size (hw, hh).
function roundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const bar = (x1, x2, y, h) => (x, y0) => roundRect(x, y0, (x1 + x2) / 2, y, (x2 - x1) / 2, h / 2, h / 2);
const shapes = [
  { color: BG, sdf: (x, y) => roundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.23) },
  { color: WHITE, sdf: bar(0.24, 0.76, 0.3, 0.085) },
  { color: YELLOW, sdf: (x, y) => roundRect(x, y, 0.5, 0.5, 0.31, 0.085, 0.04) },
  { color: WHITE, sdf: bar(0.24, 0.6, 0.7, 0.085) },
];

function pixel(px, py, size) {
  const SS = 4;
  let r = 0, g = 0, b = 0, a = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size;
      const y = (py + (sy + 0.5) / SS) / size;
      let hit = null;
      for (const s of shapes) if (s.sdf(x, y) <= 0) hit = s.color;
      if (hit) { r += hit[0]; g += hit[1]; b += hit[2]; a += 1; }
    }
  }
  if (!a) return [0, 0, 0, 0];
  return [r / a, g / a, b / a, (a / (SS * SS)) * 255].map(Math.round);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x, y, size);
      p.forEach((v, i) => (raw[y * (size * 4 + 1) + 1 + x * 4 + i] = v));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png(size));
}
console.log('icons written to', outDir);
