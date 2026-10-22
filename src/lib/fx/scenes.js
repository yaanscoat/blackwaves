// animated backgrounds. each scene is { init(state), draw(ctx, state, t, dt) }.
// they all draw onto one full-screen canvas behind everything else.

export const BACKGROUNDS = [
  { id: "tide", name: "Tide" },
  { id: "aurora", name: "Aurora" },
  { id: "nebula", name: "Nebula" },
  { id: "drift", name: "Gradient drift" },
  { id: "horizon", name: "Neon horizon" },
  { id: "caustics", name: "Deep sea light" },
  { id: "lava", name: "Lava lamp" },
  { id: "warp", name: "Warp speed" },
  { id: "plasma", name: "Plasma" },
  { id: "ripples", name: "Ripples" },
  { id: "orbs", name: "Orbs" },
  { id: "rain-code", name: "Code rain" },
  { id: "black", name: "Plain black" },
  { id: "custom", name: "Your own image or video" },
];

const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k].map(Math.round);

export const SCENES = {
  tide: {
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(colors.bg, 1));
      grad.addColorStop(1, rgba(mix(colors.bg, colors.accent, 0.12), 1));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const layers = 6;
      for (let i = 0; i < layers; i++) {
        const k = i / (layers - 1);
        const base = h * (0.62 + k * 0.06);
        const amp = 18 + k * 26;
        const speed = 0.12 + k * 0.1;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 20; x += 20) {
          const y =
            base +
            Math.sin(x * (0.0032 + k * 0.0011) + t * speed + i) * amp +
            Math.sin(x * 0.0011 - t * speed * 0.6 + i * 2.1) * amp * 0.6;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = rgba(mix(colors.bg, colors.accent, 0.05 + k * 0.07), 0.55);
        ctx.fill();
        ctx.strokeStyle = rgba(colors.accent, 0.08 + k * 0.1);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
  },

  aurora: {
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const hues = [colors.accent, [95, 242, 214], [166, 120, 255]];
      for (let band = 0; band < 3; band++) {
        ctx.beginPath();
        const yBase = h * (0.22 + band * 0.1);
        for (let x = 0; x <= w; x += 16) {
          const y = yBase + Math.sin(x * 0.004 + t * 0.25 + band) * 60 + Math.sin(x * 0.011 - t * 0.4) * 18;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineTo(w, yBase + 260);
        ctx.lineTo(0, yBase + 260);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, yBase - 60, 0, yBase + 260);
        g.addColorStop(0, rgba(hues[band], 0.0));
        g.addColorStop(0.2, rgba(hues[band], 0.16));
        g.addColorStop(1, rgba(hues[band], 0));
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },

  nebula: {
    init(s) {
      s.blobs = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.25 + Math.random() * 0.3, p: Math.random() * 7, c: i % 3 }));
    },
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, 0, w, h);
      const palette = [colors.accent, [228, 108, 255], [95, 242, 214]];
      ctx.globalCompositeOperation = "lighter";
      for (const b of s.blobs) {
        const x = (b.x + Math.sin(t * 0.03 + b.p) * 0.08) * w;
        const y = (b.y + Math.cos(t * 0.025 + b.p) * 0.08) * h;
        const r = b.r * Math.max(w, h);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(palette[b.c], 0.13));
        g.addColorStop(1, rgba(palette[b.c], 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },

  drift: {
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, 0, w, h);
      const points = [
        [0.2 + Math.sin(t * 0.07) * 0.15, 0.3 + Math.cos(t * 0.05) * 0.2, colors.accent],
        [0.8 + Math.cos(t * 0.06) * 0.15, 0.25 + Math.sin(t * 0.08) * 0.15, mix(colors.accent, [255, 120, 200], 0.6)],
        [0.5 + Math.sin(t * 0.05 + 2) * 0.2, 0.85 + Math.cos(t * 0.07) * 0.1, mix(colors.accent, [95, 242, 214], 0.7)],
      ];
      for (const [px, py, c] of points) {
        const g = ctx.createRadialGradient(px * w, py * h, 0, px * w, py * h, Math.max(w, h) * 0.55);
        g.addColorStop(0, rgba(c, 0.22));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    },
  },

  horizon: {
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      const horizon = h * 0.58;
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, rgba(colors.bg, 1));
      sky.addColorStop(1, rgba(mix(colors.bg, colors.accent, 0.25), 1));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, horizon);
      // the sun, with the obligatory stripes
      const sunR = Math.min(w, h) * 0.16;
      const sun = ctx.createLinearGradient(0, horizon - sunR * 2, 0, horizon);
      sun.addColorStop(0, "rgba(255,206,92,0.9)");
      sun.addColorStop(1, "rgba(255,79,216,0.85)");
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, horizon - sunR * 0.2, sunR, Math.PI, 0);
      ctx.clip();
      ctx.fillStyle = sun;
      ctx.fillRect(w / 2 - sunR, horizon - sunR * 1.3, sunR * 2, sunR * 1.3);
      ctx.fillStyle = rgba(colors.bg, 1);
      for (let i = 0; i < 6; i++) ctx.fillRect(w / 2 - sunR, horizon - sunR * 0.2 - i * sunR * 0.13 - 2, sunR * 2, 2 + i * 0.6);
      ctx.restore();
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, horizon, w, h - horizon);
      ctx.strokeStyle = rgba(colors.accent, 0.45);
      ctx.lineWidth = 1;
      const offset = (t * 0.35) % 1;
      for (let i = 0; i < 18; i++) {
        const z = (i + offset) / 18;
        const y = horizon + Math.pow(z, 2.2) * (h - horizon);
        ctx.globalAlpha = z;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.6;
      for (let i = -16; i <= 16; i++) {
        ctx.beginPath();
        ctx.moveTo(w / 2 + i * 14, horizon);
        ctx.lineTo(w / 2 + i * w * 0.12, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },

  caustics: {
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba(mix(colors.bg, colors.accent, 0.18), 1));
      g.addColorStop(1, rgba(colors.bg, 1));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 22; i++) {
        ctx.strokeStyle = rgba(colors.accent, 0.035);
        ctx.beginPath();
        for (let y = 0; y <= h; y += 24) {
          const x = (i / 22) * w + Math.sin(y * 0.01 + t * 0.6 + i * 1.7) * 40 + Math.sin(y * 0.023 - t * 0.4 + i) * 18;
          if (y === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // god rays from the surface
      for (let i = 0; i < 5; i++) {
        const x = w * (0.15 + i * 0.18) + Math.sin(t * 0.1 + i) * 40;
        const ray = ctx.createLinearGradient(x, 0, x + 120, h);
        ray.addColorStop(0, rgba(colors.text, 0.06));
        ray.addColorStop(1, rgba(colors.text, 0));
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(x - 30, 0);
        ctx.lineTo(x + 30, 0);
        ctx.lineTo(x + 220, h);
        ctx.lineTo(x + 60, h);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },

  lava: {
    init(s) {
      s.blobs = Array.from({ length: 9 }, () => ({ x: Math.random(), y: Math.random(), vy: (Math.random() - 0.5) * 0.03, r: 0.06 + Math.random() * 0.08, p: Math.random() * 6 }));
    },
    draw(ctx, s, t, dt) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, 0, w, h);
      ctx.filter = "blur(28px)";
      for (const b of s.blobs) {
        b.y += b.vy * dt;
        if (b.y < -0.1 || b.y > 1.1) b.vy *= -1;
        const x = (b.x + Math.sin(t * 0.2 + b.p) * 0.05) * w;
        const r = b.r * Math.min(w, h) * (1 + Math.sin(t * 0.5 + b.p) * 0.15);
        ctx.fillStyle = rgba(mix(colors.accent, [255, 110, 80], b.p / 6), 0.55);
        ctx.beginPath();
        ctx.arc(x, b.y * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.filter = "none";
    },
  },

  warp: {
    init(s) {
      s.stars = Array.from({ length: 420 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() }));
    },
    draw(ctx, s, t, dt) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 0.35);
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      ctx.strokeStyle = rgba(colors.text, 0.8);
      for (const star of s.stars) {
        const pz = star.z;
        star.z -= dt * 0.18;
        if (star.z <= 0.02) {
          star.z = 1;
          star.x = (Math.random() - 0.5) * 2;
          star.y = (Math.random() - 0.5) * 2;
          continue;
        }
        const sx = cx + (star.x / star.z) * cx * 0.5;
        const sy = cy + (star.y / star.z) * cy * 0.5;
        const px = cx + (star.x / pz) * cx * 0.5;
        const py = cy + (star.y / pz) * cy * 0.5;
        ctx.globalAlpha = Math.min(1, (1 - star.z) * 1.4);
        ctx.lineWidth = (1 - star.z) * 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },

  plasma: {
    init(s) {
      s.small = document.createElement("canvas");
      s.small.width = 96;
      s.small.height = 54;
      s.sctx = s.small.getContext("2d");
      s.img = s.sctx.createImageData(96, 54);
    },
    draw(ctx, s, t) {
      const { w, h, colors, img } = s;
      const a = colors.accent;
      const b = colors.bg;
      for (let y = 0; y < 54; y++) {
        for (let x = 0; x < 96; x++) {
          const v = (Math.sin(x * 0.09 + t * 0.6) + Math.sin(y * 0.11 - t * 0.4) + Math.sin((x + y) * 0.06 + t * 0.3) + Math.sin(Math.hypot(x - 48, y - 27) * 0.12 - t)) / 4;
          const k = (v + 1) * 0.5 * 0.42;
          const i = (y * 96 + x) * 4;
          img.data[i] = b[0] + (a[0] - b[0]) * k;
          img.data[i + 1] = b[1] + (a[1] - b[1]) * k;
          img.data[i + 2] = b[2] + (a[2] - b[2]) * k;
          img.data[i + 3] = 255;
        }
      }
      s.sctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(s.small, 0, 0, w, h);
    },
  },

  ripples: {
    init(s) {
      s.rings = [];
      s.next = 0;
    },
    draw(ctx, s, t) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, 0, w, h);
      if (t > s.next) {
        s.rings.push({ x: Math.random() * w, y: Math.random() * h, born: t });
        s.next = t + 0.9 + Math.random() * 1.2;
      }
      s.rings = s.rings.filter((ring) => t - ring.born < 7);
      ctx.lineWidth = 1.2;
      for (const ring of s.rings) {
        const age = t - ring.born;
        for (let k = 0; k < 3; k++) {
          const r = (age - k * 0.4) * 70;
          if (r <= 0) continue;
          ctx.strokeStyle = rgba(colors.accent, Math.max(0, 0.32 - age * 0.045));
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },
  },

  orbs: {
    init(s) {
      s.orbs = Array.from({ length: 6 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.04, vy: (Math.random() - 0.5) * 0.04, r: 80 + Math.random() * 140, c: Math.random() }));
    },
    draw(ctx, s, t, dt) {
      const { w, h, colors } = s;
      ctx.fillStyle = rgba(colors.bg, 1);
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const o of s.orbs) {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        if (o.x < 0 || o.x > 1) o.vx *= -1;
        if (o.y < 0 || o.y > 1) o.vy *= -1;
        const color = mix(colors.accent, [95, 242, 214], o.c);
        const g = ctx.createRadialGradient(o.x * w, o.y * h, 0, o.x * w, o.y * h, o.r);
        g.addColorStop(0, rgba(color, 0.32));
        g.addColorStop(0.5, rgba(color, 0.08));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.x * w, o.y * h, o.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },

  "rain-code": {
    init(s) {
      s.cols = [];
      s.glyphs = "アイウエオカキクケコサシスセソ0123456789blackwaves<>/{}=+";
    },
    draw(ctx, s, t, dt) {
      const { w, h, colors } = s;
      const size = 16;
      const count = Math.ceil(w / size);
      while (s.cols.length < count) s.cols.push(Math.random() * -h);
      ctx.fillStyle = rgba(colors.bg, 0.12);
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${size - 2}px Lexend, monospace`;
      for (let i = 0; i < count; i++) {
        s.cols[i] += dt * 160 * (0.6 + ((i * 7) % 5) / 6);
        if (s.cols[i] > h + 40) s.cols[i] = Math.random() * -200;
        ctx.fillStyle = rgba(colors.accent, 0.55);
        ctx.fillText(s.glyphs[(Math.floor(t * 8) + i * 13) % s.glyphs.length], i * size, s.cols[i]);
      }
    },
  },

  black: {
    draw(ctx, s) {
      ctx.fillStyle = rgba(s.colors.bg, 1);
      ctx.fillRect(0, 0, s.w, s.h);
    },
  },
};
