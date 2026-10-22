// particle modes. each has spawn(p, w, h, initial) and step(p, dt, w, h, s) -> draws itself.

export const PARTICLES = [
  { id: "off", name: "Off" },
  { id: "dust", name: "Dust & hidden lights" },
  { id: "snow", name: "Snow" },
  { id: "rain", name: "Rain" },
  { id: "sparks", name: "Fire sparks" },
  { id: "stars", name: "Twinkling stars" },
  { id: "bubbles", name: "Bubbles" },
  { id: "fireflies", name: "Fireflies" },
  { id: "petals", name: "Sakura petals" },
  { id: "leaves", name: "Autumn leaves" },
  { id: "plankton", name: "Glowing plankton" },
  { id: "meteors", name: "Meteor shower" },
];

const R = Math.random;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const MODES = {
  dust: {
    count: 140,
    spawn(p, w, h) {
      p.x = R() * w;
      p.y = R() * h;
      p.vx = (R() - 0.5) * 6;
      p.vy = (R() - 0.5) * 6;
      p.r = 0.6 + R() * 1.6;
    },
    // three light sources wander around off-screen-ish. dust only shows up in their beams.
    frame(s, t) {
      s.lights = [0, 1, 2].map((i) => ({
        x: s.w * (0.5 + Math.sin(t * 0.07 + i * 2.1) * 0.45),
        y: s.h * (0.5 + Math.cos(t * 0.05 + i * 1.3) * 0.45),
      }));
      const ctx = s.ctx;
      ctx.globalCompositeOperation = "lighter";
      for (const light of s.lights) {
        const g = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, Math.max(s.w, s.h) * 0.35);
        g.addColorStop(0, rgba(s.colors.accent, 0.05));
        g.addColorStop(1, rgba(s.colors.accent, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s.w, s.h);
      }
      ctx.globalCompositeOperation = "source-over";
    },
    step(p, dt, s) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 0) p.x += s.w;
      if (p.x > s.w) p.x -= s.w;
      if (p.y < 0) p.y += s.h;
      if (p.y > s.h) p.y -= s.h;
      let glow = 0.04;
      const reach = Math.max(s.w, s.h) * 0.3;
      for (const light of s.lights) {
        const d = Math.hypot(p.x - light.x, p.y - light.y);
        glow += Math.max(0, 1 - d / reach) * 0.7;
      }
      s.ctx.fillStyle = rgba(s.colors.text, Math.min(0.85, glow));
      s.ctx.beginPath();
      s.ctx.arc(p.x, p.y, p.r, 0, 6.283);
      s.ctx.fill();
    },
  },

  snow: {
    count: 160,
    spawn(p, w, h, initial) {
      p.x = R() * w;
      p.y = initial ? R() * h : -10;
      p.r = 0.8 + R() * 2.4;
      p.vy = 18 + p.r * 14;
      p.ph = R() * 6;
    },
    step(p, dt, s, t) {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 0.8 + p.ph) * 12 * dt;
      if (p.y > s.h + 10) MODES.snow.spawn(p, s.w, s.h);
      s.ctx.fillStyle = rgba(s.colors.text, 0.35 + p.r * 0.15);
      s.ctx.beginPath();
      s.ctx.arc(p.x, p.y, p.r, 0, 6.283);
      s.ctx.fill();
    },
  },

  rain: {
    count: 200,
    spawn(p, w, h, initial) {
      p.x = R() * (w + 200) - 100;
      p.y = initial ? R() * h : -20;
      p.len = 10 + R() * 18;
      p.vy = 700 + R() * 400;
    },
    step(p, dt, s) {
      p.y += p.vy * dt;
      p.x += p.vy * 0.12 * dt;
      if (p.y > s.h + 20) MODES.rain.spawn(p, s.w, s.h);
      s.ctx.strokeStyle = rgba(s.colors.accent, 0.35);
      s.ctx.lineWidth = 1;
      s.ctx.beginPath();
      s.ctx.moveTo(p.x, p.y);
      s.ctx.lineTo(p.x - p.len * 0.12, p.y - p.len);
      s.ctx.stroke();
    },
  },

  sparks: {
    count: 110,
    spawn(p, w, h, initial) {
      p.x = R() * w;
      p.y = initial ? R() * h : h + 10;
      p.vy = -(40 + R() * 90);
      p.vx = (R() - 0.5) * 30;
      p.life = 0;
      p.max = 3 + R() * 4;
      p.r = 0.8 + R() * 1.8;
    },
    step(p, dt, s, t) {
      p.life += dt;
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * 2 + p.max) * 20) * dt;
      if (p.life > p.max || p.y < -10) MODES.sparks.spawn(p, s.w, s.h);
      const k = 1 - p.life / p.max;
      s.ctx.fillStyle = `rgba(255,${Math.round(120 + 100 * k)},${Math.round(40 * k)},${0.85 * k})`;
      s.ctx.shadowColor = "rgba(255,140,40,0.8)";
      s.ctx.shadowBlur = 6;
      s.ctx.beginPath();
      s.ctx.arc(p.x, p.y, p.r, 0, 6.283);
      s.ctx.fill();
      s.ctx.shadowBlur = 0;
    },
  },

  stars: {
    count: 220,
    spawn(p, w, h) {
      p.x = R() * w;
      p.y = R() * h;
      p.r = 0.4 + R() * 1.3;
      p.ph = R() * 6;
      p.sp = 0.5 + R() * 2;
    },
    step(p, dt, s, t) {
      const a = 0.25 + (Math.sin(t * p.sp + p.ph) + 1) * 0.35;
      s.ctx.fillStyle = rgba(s.colors.text, a);
      s.ctx.beginPath();
      s.ctx.arc(p.x, p.y, p.r, 0, 6.283);
      s.ctx.fill();
    },
  },

  bubbles: {
    count: 60,
    spawn(p, w, h, initial) {
      p.x = R() * w;
      p.y = initial ? R() * h : h + 20;
      p.r = 2 + R() * 9;
      p.vy = -(15 + R() * 35);
      p.ph = R() * 6;
    },
    step(p, dt, s, t) {
      p.y += p.vy * dt;
      p.x += Math.sin(t + p.ph) * 10 * dt;
      if (p.y < -20) MODES.bubbles.spawn(p, s.w, s.h);
      const ctx = s.ctx;
      ctx.strokeStyle = rgba(s.colors.accent, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = rgba(s.colors.text, 0.35);
      ctx.beginPath();
      ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.22, 0, 6.283);
      ctx.fill();
    },
  },

  fireflies: {
    count: 45,
    spawn(p, w, h) {
      p.x = R() * w;
      p.y = R() * h;
      p.a = R() * 6;
      p.sp = 10 + R() * 25;
      p.ph = R() * 6;
    },
    step(p, dt, s, t) {
      p.a += (R() - 0.5) * 2 * dt;
      p.x += Math.cos(p.a) * p.sp * dt;
      p.y += Math.sin(p.a) * p.sp * dt;
      if (p.x < -20 || p.x > s.w + 20 || p.y < -20 || p.y > s.h + 20) MODES.fireflies.spawn(p, s.w, s.h);
      const glow = (Math.sin(t * 1.6 + p.ph) + 1) / 2;
      const g = s.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
      g.addColorStop(0, `rgba(220,255,140,${0.9 * glow})`);
      g.addColorStop(1, "rgba(220,255,140,0)");
      s.ctx.fillStyle = g;
      s.ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
    },
  },

  petals: {
    count: 55,
    spawn(p, w, h, initial) {
      p.x = R() * w;
      p.y = initial ? R() * h : -12;
      p.s = 4 + R() * 5;
      p.vy = 25 + R() * 35;
      p.rot = R() * 6;
      p.vr = (R() - 0.5) * 2;
      p.ph = R() * 6;
    },
    step(p, dt, s, t) {
      p.y += p.vy * dt;
      p.x += (Math.sin(t * 0.9 + p.ph) * 30 + 15) * dt;
      p.rot += p.vr * dt;
      if (p.y > s.h + 12) MODES.petals.spawn(p, s.w, s.h);
      const ctx = s.ctx;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = "rgba(255,170,205,0.75)";
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 6.283);
      ctx.fill();
      ctx.restore();
    },
  },

  leaves: {
    count: 40,
    spawn(p, w, h, initial) {
      MODES.petals.spawn(p, w, h, initial);
      p.s = 6 + R() * 6;
      p.hue = [[233, 120, 45], [205, 72, 40], [240, 180, 60]][Math.floor(R() * 3)];
    },
    step(p, dt, s, t) {
      p.y += p.vy * dt;
      p.x += Math.sin(t * 0.7 + p.ph) * 40 * dt;
      p.rot += p.vr * 1.6 * dt;
      if (p.y > s.h + 12) MODES.leaves.spawn(p, s.w, s.h);
      const ctx = s.ctx;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = rgba(p.hue, 0.8);
      ctx.beginPath();
      ctx.moveTo(0, -p.s);
      ctx.quadraticCurveTo(p.s * 0.8, 0, 0, p.s);
      ctx.quadraticCurveTo(-p.s * 0.8, 0, 0, -p.s);
      ctx.fill();
      ctx.restore();
    },
  },

  plankton: {
    count: 120,
    spawn(p, w, h) {
      p.x = R() * w;
      p.y = R() * h;
      p.vx = (R() - 0.5) * 8;
      p.vy = (R() - 0.5) * 8;
      p.ph = R() * 6;
      p.r = 0.8 + R() * 1.5;
    },
    step(p, dt, s, t) {
      // plankton lights up when your cursor swims past
      const d = Math.hypot(p.x - s.mouse.x, p.y - s.mouse.y);
      const boost = Math.max(0, 1 - d / 160);
      if (boost > 0) {
        p.vx += ((p.x - s.mouse.x) / (d || 1)) * 30 * dt;
        p.vy += ((p.y - s.mouse.y) / (d || 1)) * 30 * dt;
      }
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.x = (p.x + p.vx * dt + s.w) % s.w;
      p.y = (p.y + p.vy * dt + s.h) % s.h;
      const a = 0.15 + (Math.sin(t * 2 + p.ph) + 1) * 0.12 + boost * 0.7;
      s.ctx.fillStyle = `rgba(95,242,214,${a})`;
      s.ctx.beginPath();
      s.ctx.arc(p.x, p.y, p.r + boost * 1.5, 0, 6.283);
      s.ctx.fill();
    },
  },

  meteors: {
    count: 8,
    spawn(p, w, h, initial) {
      p.x = R() * w * 1.4;
      p.y = initial ? R() * h * -1 : -30 - R() * h;
      p.v = 500 + R() * 500;
      p.len = 80 + R() * 120;
    },
    step(p, dt, s) {
      p.x -= p.v * 0.7 * dt;
      p.y += p.v * 0.7 * dt;
      if (p.y > s.h + 60 || p.x < -200) MODES.meteors.spawn(p, s.w, s.h);
      const ctx = s.ctx;
      const g = ctx.createLinearGradient(p.x, p.y, p.x + p.len * 0.7, p.y - p.len * 0.7);
      g.addColorStop(0, rgba(s.colors.text, 0.9));
      g.addColorStop(1, rgba(s.colors.text, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.len * 0.7, p.y - p.len * 0.7);
      ctx.stroke();
    },
  },
};
