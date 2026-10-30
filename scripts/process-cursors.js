// turns the windows cursor packs in assets/cur (zips of .cur and .ani files from
// rw-designer.com) into something a browser can use: one png per frame in
// assets/cursors/<pack>/ plus assets/cursors/index.json, which says which file is
// which css cursor, where its hotspot is and how long each frame shows.
// browsers can't read .ani at all and play no animated cursors, so the page
// swaps the frames itself (see src/lib/cursors.js).
//
// usage: node scripts/process-cursors.js
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const input = path.join(root, "assets", "cur");
const output = path.join(root, "assets", "cursors");

// which file in each pack is which css cursor. a pack can leave cursors out;
// the page falls back to the normal one for those. `hot` fixes hotspots the
// author left in the corner.
const PACKS = {
  "4leaf": {
    name: "4LEAF",
    roles: {
      default: "Arrow.ani",
      pointer: "Hand.cur",
      text: "IBeam.cur",
      help: "Help.cur",
      wait: "Wait.ani",
      progress: "AppStarting.ani",
      crosshair: "Cross.ani",
      move: "Move.ani",
      "not-allowed": "No.cur",
      "ns-resize": "SizeNS.ani",
      "ew-resize": "SizeWE.ani",
      "nwse-resize": "SizeNWSE.ani",
      "nesw-resize": "SizeNESW.ani",
    },
  },
  "accessability-lh": {
    name: "Left-handed classic",
    roles: { default: "lefthand.cur", pointer: "link_L.cur", help: "leftj_help.cur", wait: "lefthandwait.cur", progress: "lefthandwait.cur" },
  },
  "another-cool-set": {
    name: "Earth",
    roles: {
      default: "Earth_Pointer.ani",
      pointer: "Earth_link_select.ani",
      text: "Earth_text.ani",
      help: "Earth_help.ani",
      wait: "Earth_waiting.ani",
      progress: "Earth_working.ani",
      crosshair: "Earth_crosshair.ani.cur",
      move: "Earth_moving.ani",
      "not-allowed": "Earth_unavailable.ani",
      "ns-resize": "Earth_moving_vertical.ani",
      "ew-resize": "Earth_moving_horizontal.ani",
      "nwse-resize": "Earth_moving_diagonal1.ani",
      "nesw-resize": "Earth_moving_diagonal2.ani",
    },
  },
  bgaero: {
    name: "Black-green Aero",
    roles: {
      default: "bg-aero-normal.cur",
      pointer: "bg-aero-link.cur",
      text: "bg-aero_select.cur",
      help: "bg-aero-help.cur",
      wait: "bg-aero_busy.ani",
      progress: "bg-aero_working.ani",
      crosshair: "bg-aero-cross.cur",
      move: "bg-aero-NSEW.cur",
      "not-allowed": "be-aero_unavail.cur",
      "ns-resize": "bg-aero-ns.cur",
      "ew-resize": "bg-aero-E-W.cur",
      "nwse-resize": "bg-aero_nwse.cur",
      "nesw-resize": "bg-aero-nesw.cur",
    },
  },
  dove: {
    name: "Dove",
    roles: {
      default: "Dove Cursor.cur",
      pointer: "link select.ani",
      text: "text select.ani",
      help: "Help Select.cur",
      wait: "Busy.ani",
      progress: "Working In Background.ani",
      crosshair: "percision select.ani",
      move: "move.ani",
      "not-allowed": "unavailable.cur",
      "ns-resize": "vertical resize.ani",
      "ew-resize": "horizontal resize.ani",
      "nwse-resize": "diagonal resize 1.ani",
      "nesw-resize": "diagonal resize 2.ani",
    },
  },
  "fake-rs-items": {
    name: "Fantasy items",
    roles: { default: "guthsword.cur", pointer: "igh.cur", text: "igp.cur", wait: "igk.cur", progress: "igk.cur", help: "igl.cur" },
  },
  greeney: {
    name: "Greeny",
    roles: {
      default: "greeny_normal.cur",
      help: "greeny_question.cur",
      wait: "greeny_really_busy.cur",
      progress: "greeny_slightly_busy.cur",
      crosshair: "greeny_precision.cur",
      move: "greeny_move.cur",
      "not-allowed": "greeny_unavailable.cur",
      "ns-resize": "greeny_vert.cur",
      "ew-resize": "greeny_horiz.cur",
      "nwse-resize": "greeny_diag1.cur",
      "nesw-resize": "greeny_diag2.cur",
    },
  },
  "red-pointy-sharp": {
    name: "Reddypoint",
    roles: {
      default: "reddypoint-steadypoint.ani",
      pointer: "reddypoint-steadypoint-link.ani",
      text: "reddypoint-steadypoint-text-select.cur",
      help: "reddy-question-cursor.cur",
      wait: "zzzzzz.cur",
      progress: "new-hold.cur",
      crosshair: "reddypoint-steadypoint-precision-select.cur",
      move: "reddypoint-move.ani",
      "not-allowed": "reddypoint-unavailable.cur",
      "ns-resize": "reddypoint-steadypoint-vertical-resize.ani",
      "ew-resize": "reddypoint-steadypoint-horizontal-resize.ani",
      "nwse-resize": "reddypoint-steadypoint-diagonal-resize-1.ani",
      "nesw-resize": "reddypoint-steadypoint-diagonal-resize-2.ani",
    },
    hot: { crosshair: [15, 15] },
  },
  roblox2026: {
    name: "Roblox 2026",
    roles: {
      default: "ArrowFarCursor.cur",
      pointer: "ArrowCursor.cur",
      text: "IBeamCursor.cur",
      help: "Info.cur",
      crosshair: "PivotEditor.cur",
      grab: "HoverCursor.cur",
      grabbing: "ActivatedCursor.cur",
      move: "ActivatedCursor.cur",
      "not-allowed": "Error.cur",
    },
  },
  stickman: {
    name: "StickDude",
    roles: { default: "smlmov.ani", pointer: "dangleboy.ani", help: "helpcur.ani", wait: "bombclock.ani", progress: "wait_stick.ani" },
  },
};

// ---- zip ----------------------------------------------------------------------------

function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("latin1", at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    // some packs have the same name twice; the first one wins
    if (!files.has(name)) files.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ---- .cur / .ico ---------------------------------------------------------------------

function decodeDib(data, width) {
  const bits = data.readUInt16LE(14);
  const headerSize = data.readUInt32LE(0);
  const height = Math.abs(data.readInt32LE(8)) / 2;
  const colors = bits <= 8 ? data.readUInt32LE(32) || 1 << bits : 0;
  const palette = headerSize;
  const xor = palette + colors * 4;
  const xorStride = Math.ceil((width * bits) / 32) * 4;
  const and = xor + xorStride * height;
  const andStride = Math.ceil(width / 32) * 4;
  const rgba = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = xor + (height - 1 - y) * xorStride;
    const maskRow = and + (height - 1 - y) * andStride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r, g, b, a = 255;
      if (bits === 32) {
        [b, g, r, a] = [data[row + x * 4], data[row + x * 4 + 1], data[row + x * 4 + 2], data[row + x * 4 + 3]];
        if (a) anyAlpha = true;
      } else if (bits === 24) {
        [b, g, r] = [data[row + x * 3], data[row + x * 3 + 1], data[row + x * 3 + 2]];
      } else {
        const index = (data[row + ((x * bits) >> 3)] >> (8 - bits - ((x * bits) & 7))) & ((1 << bits) - 1);
        [b, g, r] = [data[palette + index * 4], data[palette + index * 4 + 1], data[palette + index * 4 + 2]];
      }
      const masked = and + andStride * height <= data.length && (data[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      rgba.set([r, g, b, a], o);
      if (bits !== 32) {
        // and-mask 1 = see-through; with a non-black colour windows inverts the
        // screen there, which a browser can't, so that shows as plain white
        if (masked) rgba.set(r || g || b ? [255, 255, 255, 255] : [0, 0, 0, 0], o);
      } else rgba[o + 3] = masked ? 0 : 255;
    }
  }
  // 32-bit images with real alpha ignore the mask
  if (bits === 32 && anyAlpha) {
    for (let y = 0; y < height; y++) {
      const row = xor + (height - 1 - y) * xorStride;
      for (let x = 0; x < width; x++) rgba[(y * width + x) * 4 + 3] = data[row + x * 4 + 3];
    }
  }
  return { width, height, rgba };
}

/** the best image in a .cur/.ico: as close to 32px as possible, then the most colours */
function decodeCursor(buffer) {
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const width = buffer[at] || 256;
    entries.push({
      width,
      height: buffer[at + 1] || 256,
      hotX: type === 2 ? buffer.readUInt16LE(at + 4) : 0,
      hotY: type === 2 ? buffer.readUInt16LE(at + 6) : 0,
      bits: type === 1 ? buffer.readUInt16LE(at + 6) : 0,
      data: buffer.subarray(buffer.readUInt32LE(at + 12), buffer.readUInt32LE(at + 12) + buffer.readUInt32LE(at + 8)),
    });
  }
  const score = (entry) => Math.abs(entry.width - 32) * 1000 - (entry.data.readUInt32LE(0) === 40 ? entry.data.readUInt16LE(14) : 32);
  const best = entries.sort((a, b) => score(a) - score(b))[0];
  if (best.data.readUInt32LE(0) === 0x474e5089) {
    // already a png inside; keep it as it is
    return { width: best.data.readUInt32BE(16), height: best.data.readUInt32BE(20), hotX: best.hotX, hotY: best.hotY, png: Buffer.from(best.data) };
  }
  return { ...decodeDib(best.data, best.width), hotX: best.hotX, hotY: best.hotY };
}

// ---- .ani --------------------------------------------------------------------------

function decodeAni(buffer) {
  if (buffer.toString("latin1", 0, 4) !== "RIFF") return { frames: [decodeCursor(buffer)], steps: [{ frame: 0, ms: 0 }] };
  let header = null;
  let rate = null;
  let sequence = null;
  const frames = [];
  const walk = (start, end) => {
    let at = start;
    while (at + 8 <= end) {
      const id = buffer.toString("latin1", at, at + 4);
      const size = buffer.readUInt32LE(at + 4);
      const body = buffer.subarray(at + 8, at + 8 + size);
      if (id === "LIST") walk(at + 12, at + 8 + size);
      else if (id === "anih") header = { frames: body.readUInt32LE(4), steps: body.readUInt32LE(8), jiffies: body.readUInt32LE(28) || 10 };
      else if (id === "rate") rate = Array.from({ length: size / 4 }, (_, i) => body.readUInt32LE(i * 4));
      else if (id === "seq ") sequence = Array.from({ length: size / 4 }, (_, i) => body.readUInt32LE(i * 4));
      else if (id === "icon") frames.push(decodeCursor(body));
      at += 8 + size + (size & 1);
    }
  };
  walk(12, buffer.length);
  const stepCount = sequence?.length || header?.steps || frames.length;
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    frame: Math.min(sequence ? sequence[i] : i, frames.length - 1),
    // a jiffy is 1/60 s
    ms: Math.round(((rate?.[i] ?? header?.jiffies ?? 10) * 1000) / 60),
  }));
  // the hotspot can sit on just the first frame
  for (const frame of frames) if (!frame.hotX && !frame.hotY) Object.assign(frame, { hotX: frames[0].hotX, hotY: frames[0].hotY });
  return { frames, steps };
}

// ---- png --------------------------------------------------------------------------

function png({ width, height, rgba, png: ready }) {
  if (ready) return ready;
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- readme -------------------------------------------------------------------------

function credits(readme) {
  const text = readme.toString("utf8").replace(/^﻿/, "");
  // just the name: the readmes also carry the authors' email addresses
  const author = /^By:\s*(.+)$/m.exec(text)?.[1].replace(/\s*\(.*$/, "").trim() || "unknown";
  const link = /^Download:\s*(\S+)/m.exec(text)?.[1].replace(/^http:/, "https:") || "";
  const license = /^License:\s*(.+)$/m.exec(text)?.[1].trim() || "";
  return { author, link, license: /public domain/i.test(license) ? "Public domain" : /attribution/i.test(license) ? "CC BY" : license };
}

// ---- go --------------------------------------------------------------------------

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const index = [];
let bytes = 0;
for (const [id, pack] of Object.entries(PACKS)) {
  const zip = path.join(input, `${id}.zip`);
  if (!fs.existsSync(zip)) {
    console.warn(`skipping ${id}: no ${id}.zip`);
    continue;
  }
  const files = unzip(fs.readFileSync(zip));
  const dir = path.join(output, id);
  fs.mkdirSync(dir);
  const roles = {};
  const written = new Map();
  for (const [role, file] of Object.entries(pack.roles)) {
    const source = files.get(file);
    if (!source) throw new Error(`${id}: no ${file}`);
    if (written.has(file)) {
      roles[role] = written.get(file);
      continue;
    }
    const { frames, steps } = decodeAni(source);
    const first = frames[steps[0].frame];
    if (first.width > 128 || first.height > 128) throw new Error(`${id}/${file} is ${first.width}px; browsers ignore cursors over 128px`);
    const names = frames.map((frame, i) => {
      const name = frames.length > 1 ? `${role}-${i}.png` : `${role}.png`;
      const data = png(frame);
      bytes += data.length;
      fs.writeFileSync(path.join(dir, name), data);
      return name;
    });
    const entry = { hot: pack.hot?.[role] || [first.hotX, first.hotY], size: [first.width, first.height], frames: steps.map((step) => names[step.frame]) };
    if (steps.length > 1) entry.ms = steps.map((step) => Math.max(step.ms, 16));
    roles[role] = entry;
    written.set(file, entry);
  }
  index.push({ id, name: pack.name, ...credits(files.get("readme.txt")), roles });
  console.log(`${id}: ${Object.keys(roles).length} cursors`);
}
fs.writeFileSync(path.join(output, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
console.log(`wrote ${index.length} packs, ${(bytes / 1024).toFixed(0)} kB of png`);
