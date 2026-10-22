// the foreground effects layer: confetti, click sparks and cursor trails.
// one canvas above everything, pointer-events: none, paused when idle.
import { settings } from "../settings.js";

let canvas;
let ctx;
let pieces = [];
let trail = [];
let raf = 0;
let running = false;
const R = Math.random;

function accent() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7aa7ff";
}

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-overlay";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  ctx = canvas.getContext("2d");
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);
}

function allowed() {
  return settings.value.motion !== "off" && settings.value.motion !== "minimal";
}

function loop() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const now = performance.now();
  pieces = pieces.filter((p) => now - p.born < p.life);
  for (const p of pieces) {
    const age = (now - p.born) / p.life;
    p.vy += p.g;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - age * age);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.emoji) {
      ctx.font = `${p.size}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.emoji, 0, 0);
    } else if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    else if (p.shape === "star") {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        ctx.lineTo(Math.cos((i * 4 * Math.PI) / 5) * p.size, Math.sin((i * 4 * Math.PI) / 5) * p.size);
      }
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  trail = trail.filter((point) => now - point.at < 450);
  const mode = settings.value.cursorTrail;
  if (trail.length > 1 && mode !== "off") {
    const color = accent();
    if (mode === "ribbon") {
      ctx.lineCap = "round";
      for (let i = 1; i < trail.length; i++) {
        const k = i / trail.length;
        ctx.strokeStyle = color;
        ctx.globalAlpha = k * 0.6;
        ctx.lineWidth = k * 8;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
    } else {
      for (let i = 0; i < trail.length; i++) {
        const k = i / trail.length;
        ctx.globalAlpha = k * 0.7;
        ctx.fillStyle = mode === "rainbow" ? `hsl(${(trail[i].at / 4) % 360} 90% 65%)` : color;
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, (mode === "comet" ? 6 : 3) * k + 0.5, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  if (pieces.length || trail.length) raf = requestAnimationFrame(loop);
  else running = false;
}

function kick() {
  if (running) return;
  running = true;
  raf = requestAnimationFrame(loop);
}

export function confetti(x = innerWidth / 2, y = innerHeight / 2, amount = 140) {
  if (!allowed()) return;
  ensure();
  const colors = [accent(), "#5ff2d6", "#ffcf5c", "#ff79c6", "#ffffff", "#a678ff"];
  const now = performance.now();
  for (let i = 0; i < amount; i++) {
    const angle = R() * Math.PI * 2;
    const speed = 4 + R() * 10;
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      g: 0.28,
      drag: 0.985,
      rot: R() * 6,
      vr: (R() - 0.5) * 0.4,
      size: 6 + R() * 7,
      color: colors[i % colors.length],
      shape: R() < 0.6 ? "rect" : R() < 0.5 ? "circle" : "star",
      born: now,
      life: 1800 + R() * 1400,
    });
  }
  kick();
}

export function emojiRain(emoji, amount = 60) {
  if (!allowed()) return;
  ensure();
  const now = performance.now();
  for (let i = 0; i < amount; i++) {
    pieces.push({
      x: R() * innerWidth,
      y: -40 - R() * innerHeight * 0.8,
      vx: (R() - 0.5) * 1.5,
      vy: 2 + R() * 3,
      g: 0.12,
      drag: 0.995,
      rot: R() * 6,
      vr: (R() - 0.5) * 0.08,
      size: 22 + R() * 22,
      emoji,
      born: now,
      life: 4200 + R() * 1500,
    });
  }
  kick();
}

export function sparks(x, y, amount = 12) {
  if (!allowed()) return;
  ensure();
  const color = accent();
  const now = performance.now();
  for (let i = 0; i < amount; i++) {
    const angle = (i / amount) * Math.PI * 2 + R() * 0.4;
    const speed = 2 + R() * 3.5;
    pieces.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, g: 0.05, drag: 0.92, rot: 0, vr: 0, size: 3 + R() * 2, color, shape: "circle", born: now, life: 420 + R() * 200 });
  }
  kick();
}

export function initOverlay() {
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (settings.value.clickSparks && event.button === 0) sparks(event.clientX, event.clientY);
    },
    { passive: true },
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      if (settings.value.cursorTrail === "off" || !allowed()) return;
      ensure();
      trail.push({ x: event.clientX, y: event.clientY, at: performance.now() });
      if (trail.length > 40) trail.shift();
      kick();
    },
    { passive: true },
  );
}

export function stopOverlay() {
  cancelAnimationFrame(raf);
  running = false;
}
