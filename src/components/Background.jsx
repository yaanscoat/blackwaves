import { useEffect, useRef, useState } from "preact/hooks";
import { settings } from "../lib/settings.js";
import { SCENES } from "../lib/fx/scenes.js";
import { MODES } from "../lib/fx/particles.js";
import { getBlob } from "../lib/storage.js";
import { THEME_BY_ID } from "../data/themes.js";

const hex = (value) => {
  const n = parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function themeColors(s) {
  const theme = THEME_BY_ID.get(s.theme) || THEME_BY_ID.get("abyss");
  return { bg: hex(theme.bg), text: hex(theme.text), accent: hex(s.accent || theme.accent) };
}

function useCustomMedia(active) {
  const [media, setMedia] = useState(null);
  useEffect(() => {
    let url = "";
    let cancelled = false;
    const load = async () => {
      const blob = active ? await getBlob("background") : null;
      if (cancelled) return;
      if (url) URL.revokeObjectURL(url);
      url = blob ? URL.createObjectURL(blob) : "";
      setMedia(blob ? { url, video: blob.type.startsWith("video/") } : null);
    };
    void load();
    window.addEventListener("bw:background-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("bw:background-changed", load);
      if (url) URL.revokeObjectURL(url);
    };
  }, [active]);
  return media;
}

export function Background() {
  const sceneRef = useRef(null);
  const particleRef = useRef(null);
  const s = settings.value;
  const custom = s.background === "custom";
  const media = useCustomMedia(custom);

  useEffect(() => {
    const sceneCanvas = sceneRef.current;
    const particleCanvas = particleRef.current;
    const sctx = sceneCanvas.getContext("2d");
    const pctx = particleCanvas.getContext("2d");
    const scene = custom ? null : SCENES[s.background] || SCENES.tide;
    const mode = MODES[s.particles] || null;
    const motion = s.motion;
    const speed = motion === "reduced" ? 0.5 : 1;
    const animate = motion === "full" || motion === "reduced";
    const state = { colors: themeColors(s), mouse: { x: -999, y: -999 } };
    const pstate = { colors: state.colors, mouse: state.mouse, ctx: pctx };
    let particles = [];
    let raf = 0;
    let last = performance.now();
    let t = Math.random() * 100;

    const resize = () => {
      // the background is soft and blurry anyway, so full retina resolution is wasted gpu
      const dpr = 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const canvas of [sceneCanvas, particleCanvas]) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Object.assign(state, { w, h });
      Object.assign(pstate, { w, h });
      if (mode) {
        const density = (s.particleDensity / 50) * (motion === "reduced" ? 0.5 : 1);
        const count = Math.round(mode.count * density * Math.min(1.4, (w * h) / (1440 * 900)));
        particles = Array.from({ length: Math.max(0, count) }, () => {
          const p = {};
          mode.spawn(p, w, h, true);
          return p;
        });
      }
    };

    if (scene?.init) scene.init(state);
    resize();

    let frames = 0;
    let covered = false;
    const frame = (now) => {
      // ~40fps is plenty for drifting waves, and nobody needs the background
      // rendering behind a fullscreen game, the browser or a playing video
      if (animate && now - last < 24) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (frames++ % 20 === 0) {
        const root = document.documentElement;
        covered = root.dataset.route === "browser" || Boolean(document.querySelector(".game-player, .reader, .player-stage"));
      }
      if (covered && animate) {
        last = now;
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000) * speed;
      last = now;
      t += dt;
      if (scene) scene.draw(sctx, state, t, dt);
      pctx.clearRect(0, 0, pstate.w, pstate.h);
      if (mode && motion !== "minimal" && motion !== "off") {
        mode.frame?.(pstate, t);
        for (const p of particles) mode.step(p, dt, pstate, t);
      }
      if (animate && !document.hidden) raf = requestAnimationFrame(frame);
    };
    frame(last);

    const onVisible = () => {
      if (!document.hidden && animate) {
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const onMove = (event) => {
      state.mouse.x = event.clientX;
      state.mouse.y = event.clientY;
    };
    const onResize = () => {
      resize();
      if (!animate) frame(performance.now());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [s.background, s.particles, s.particleDensity, s.motion, s.theme, s.accent, custom]);

  return (
    <div class="bg-layer" aria-hidden="true">
      {custom && media && (media.video ? <video class="bg-media" src={media.url} autoplay muted loop playsInline /> : <img class="bg-media" src={media.url} alt="" />)}
      <canvas ref={sceneRef} class="bg-canvas" style={{ opacity: custom ? 0 : 1 }} />
      {custom && <div class="bg-dim" />}
      <canvas ref={particleRef} class="bg-canvas" />
    </div>
  );
}
