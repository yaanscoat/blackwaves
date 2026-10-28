// turns the raw discord decoration gifs in assets/profile_decor into
// assets/decor: same animation, but with the baked-in placeholder avatar
// erased so the decoration can sit on top of your real one. also writes a
// static png of the first frame for places that shouldn't animate.
//
// usage: node scripts/process-decor.js   (needs the omggif dev dependency)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import omggif from "omggif";

const { GifReader, GifWriter } = omggif;
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const input = path.join(root, "assets", "profile_decor");
const output = path.join(root, "assets", "decor");
const RADIUS = 122; // the placeholder avatar is a 240px circle in a 288px canvas
const TOLERANCE = 34; // how close a pixel has to be to the placeholder to get erased

fs.mkdirSync(output, { recursive: true });
const files = fs.readdirSync(input).filter((name) => name.endsWith(".gif"));
const gifs = files.map((name) => ({ name, reader: new GifReader(fs.readFileSync(path.join(input, name))) }));
const size = gifs[0].reader.width;
const center = size / 2;

function frameRgba(reader, index) {
  const pixels = new Uint8Array(size * size * 4);
  reader.decodeAndBlitFrameRGBA(index, pixels);
  return pixels;
}

// 1. the placeholder = per-pixel median over a sample of every gif's frames
const samples = [];
for (const { reader } of gifs) {
  const count = reader.numFrames();
  for (let k = 0; k < 6; k++) samples.push(frameRgba(reader, Math.floor((k / 6) * count)));
}
const placeholder = new Uint8Array(size * size * 4);
const channel = new Uint8Array(samples.length);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    if (Math.hypot(x + 0.5 - center, y + 0.5 - center) > RADIUS) continue;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 4; c++) {
      for (let s = 0; s < samples.length; s++) channel[s] = samples[s][i + c];
      placeholder[i + c] = [...channel].sort((a, b) => a - b)[channel.length >> 1];
    }
  }
}

function isPlaceholder(pixels, i, x, y) {
  if (Math.hypot(x + 0.5 - center, y + 0.5 - center) > RADIUS) return false;
  if (pixels[i + 3] < 128) return true;
  const d = Math.abs(pixels[i] - placeholder[i]) + Math.abs(pixels[i + 1] - placeholder[i + 1]) + Math.abs(pixels[i + 2] - placeholder[i + 2]);
  return d < TOLERANCE * 3;
}

// 2. tiny png writer for the static versions
function png(pixels) {
  const crcTable = (chunk) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(chunk.length - 4);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(chunk) >>> 0);
    return Buffer.concat([len, chunk, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    crcTable(Buffer.concat([Buffer.from("IHDR"), header])),
    crcTable(Buffer.concat([Buffer.from("IDAT"), zlib.deflateSync(raw, { level: 9 })])),
    crcTable(Buffer.from("IEND")),
  ]);
}

// 3. re-encode every frame with its original palette, placeholder pixels -> transparent
for (const { name, reader } of gifs) {
  const out = Buffer.alloc(reader.width * reader.height * reader.numFrames() * 2 + 1024 * 1024);
  const writer = new GifWriter(out, size, size, { loop: reader.loopCount() ?? 0 });
  const source = fs.readFileSync(path.join(input, name));
  let first = null;
  for (let f = 0; f < reader.numFrames(); f++) {
    const info = reader.frameInfo(f);
    const pixels = frameRgba(reader, f);
    const paletteOffset = info.palette_offset;
    const paletteSize = info.palette_size;
    const palette = [];
    const lookup = new Map();
    for (let p = 0; p < paletteSize; p++) {
      const o = paletteOffset + p * 3;
      const rgb = (source[o] << 16) | (source[o + 1] << 8) | source[o + 2];
      palette.push(rgb);
      if (!lookup.has(rgb) && p !== info.transparent_index) lookup.set(rgb, p);
    }
    let transparent = info.transparent_index;
    if (transparent === null || transparent === undefined) {
      // no transparent slot: steal the last one, it's almost never used
      transparent = paletteSize - 1;
    }
    const indices = new Uint8Array(info.width * info.height);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const gx = info.x + x;
        const gy = info.y + y;
        const i = (gy * size + gx) * 4;
        if (isPlaceholder(pixels, i, gx, gy)) {
          indices[y * info.width + x] = transparent;
          pixels[i + 3] = 0;
          continue;
        }
        const rgb = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
        indices[y * info.width + x] = pixels[i + 3] < 128 ? transparent : lookup.get(rgb) ?? 0;
      }
    }
    writer.addFrame(info.x, info.y, info.width, info.height, indices, {
      palette,
      delay: info.delay,
      disposal: 2,
      transparent,
    });
    if (f === 0) first = pixels;
  }
  const gif = out.subarray(0, writer.end());
  fs.writeFileSync(path.join(output, name), gif);
  fs.writeFileSync(path.join(output, name.replace(/\.gif$/, ".png")), png(first));
  console.log(`${name}: ${(fs.statSync(path.join(input, name)).size / 1024).toFixed(0)} KB -> ${(gif.length / 1024).toFixed(0)} KB`);
}

// 4. the newer decorations are discord's own animated pngs: transparent in the
// middle already, so they're copied as-is and drawn in front of the avatar.
// the still version is just the default image with the animation chunks dropped.
function apngStill(buffer) {
  const keep = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (!["acTL", "fcTL", "fdAT"].includes(type)) keep.push(buffer.subarray(offset, offset + 12 + length));
    offset += 12 + length;
  }
  return Buffer.concat([buffer.subarray(0, 8), ...keep]);
}

for (const name of fs.readdirSync(input).filter((file) => file.endsWith(".png"))) {
  const source = fs.readFileSync(path.join(input, name));
  fs.writeFileSync(path.join(output, name), source);
  fs.writeFileSync(path.join(output, name.replace(/\.png$/, ".still.png")), apngStill(source));
  console.log(`${name}: copied + still`);
}
