// Background canvas. Three light sources wander the screen; they are never
// drawn, so the only way to see them is the dust (or snow, rain, sparks)
// they catch.
import { hexToRgb } from "./themes.js";

const tau = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);

// Per motion level: [particle count multiplier, speed multiplier, max fps]
const motionProfile = [
    [0.55, 0, 0],
    [0.6, 0.45, 30],
    [0.8, 0.75, 45],
    [1, 1, 60]
];

const makeLights = () => [
    { ax: 0.34, ay: 0.26, fx: 0.000061, fy: 0.000083, px: 0.3, py: 1.9, r: 0.36, pulse: 0.00042 },
    { ax: 0.38, ay: 0.3, fx: 0.000047, fy: 0.000071, px: 2.4, py: 0.6, r: 0.32, pulse: 0.00036 },
    { ax: 0.28, ay: 0.34, fx: 0.000077, fy: 0.000053, px: 4.2, py: 3.1, r: 0.29, pulse: 0.00051 }
];

export const createEffects = (canvas) => {
    const ctx = canvas.getContext("2d", { alpha: true });
    const state = {
        mode: "dust",
        lighting: true,
        motion: 3,
        active: true,
        light: false,
        dust: [255, 255, 255],
        lightColors: [[255, 255, 255], [255, 255, 255], [255, 255, 255]]
    };
    const lights = makeLights();
    let w = 0, h = 0, dpr = 1;
    let particles = [];
    let frame = 0;
    let last = 0;
    let clock = 0;
    let pointerX = 0.5, pointerY = 0.5;

    addEventListener("pointermove", event => {
        pointerX = event.clientX / innerWidth;
        pointerY = event.clientY / innerHeight;
    }, { passive: true });

    const placeLights = (t) => {
        const span = Math.max(w, h);
        for (const [i, light] of lights.entries()) {
            light.x = w * (0.5 + light.ax * Math.sin(t * light.fx + light.px));
            light.y = h * (0.5 + light.ay * Math.sin(t * light.fy + light.py));
            light.radius = span * light.r * (0.9 + 0.1 * Math.sin(t * light.pulse + i));
            light.intensity = 0.82 + 0.18 * Math.sin(t * light.pulse * 1.7 + i * 2);
        }
    };

    // How brightly the hidden lights hit a point, and in what colour.
    const shade = (x, y, out) => {
        let total = 0, r = 0, g = 0, b = 0;
        for (let i = 0; i < 3; i++) {
            const light = lights[i];
            const dx = x - light.x, dy = y - light.y;
            const q = 1 - (dx * dx + dy * dy) / (light.radius * light.radius);
            if (q <= 0)
                continue;
            const f = q * q * light.intensity;
            const c = state.lightColors[i];
            total += f;
            r += c[0] * f;
            g += c[1] * f;
            b += c[2] * f;
        }
        if (total > 0) {
            out[0] = r / total;
            out[1] = g / total;
            out[2] = b / total;
        }
        return Math.min(1, total);
    };

    const spawn = {
        dust: () => ({
            x: rand(0, w), y: rand(0, h), z: rand(0.15, 1),
            vx: rand(-0.1, 0.1), vy: rand(-0.1, 0.1),
            tw: rand(0, tau), tws: rand(0.0006, 0.0022),
            // A few big out-of-focus motes give the beams some depth.
            mote: Math.random() < 0.05 ? rand(2.4, 4.6) : 0
        }),
        snow: (top) => ({
            x: rand(0, w), y: top ? rand(-h * 0.1, 0) : rand(0, h), z: rand(0.15, 1),
            sway: rand(0, tau), sways: rand(0.0004, 0.0012)
        }),
        rain: (top) => ({
            x: rand(-w * 0.1, w * 1.1), y: top ? rand(-h * 0.3, 0) : rand(0, h), z: rand(0.2, 1)
        }),
        sparks: (bottom) => ({
            x: rand(0, w), y: bottom ? h + rand(0, 40) : rand(h * 0.2, h), z: rand(0.25, 1),
            vx: rand(-0.3, 0.3), life: bottom ? 0 : rand(0, 0.8), decay: rand(0.0016, 0.004),
            fl: rand(0, tau)
        })
    };

    const density = { dust: 1500, snow: 7200, rain: 4200, sparks: 9000 };

    const populate = () => {
        particles = [];
        if (state.mode === "plain")
            return;
        const [countScale] = motionProfile[state.motion];
        const area = w * h;
        const cap = state.mode === "dust" ? 1400 : 700;
        const count = Math.min(cap, Math.round((area / density[state.mode]) * countScale));
        for (let i = 0; i < count; i++)
            particles.push(spawn[state.mode](false));
    };

    const resize = () => {
        dpr = Math.min(devicePixelRatio || 1, state.motion >= 2 ? 1.5 : 1);
        w = innerWidth;
        h = innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        populate();
    };

    const tint = [0, 0, 0];

    const drawDust = (dt, speed) => {
        const lit = state.lighting;
        const [dr, dg, db] = state.dust;
        const px = (pointerX - 0.5) * 18, py = (pointerY - 0.5) * 18;
        for (const p of particles) {
            if (speed) {
                p.vx += (Math.random() - 0.5) * 0.012 + Math.sin(p.y * 0.004 + clock * 0.00021) * 0.0016;
                p.vy += (Math.random() - 0.5) * 0.012 - 0.0009 + Math.cos(p.x * 0.003 + clock * 0.00017) * 0.0013;
                p.vx *= 0.985;
                p.vy *= 0.985;
                p.x += p.vx * p.z * dt * 0.06 * speed;
                p.y += p.vy * p.z * dt * 0.06 * speed;
                if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
                if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
                p.tw += p.tws * dt * speed;
            }
            const x = p.x + px * p.z, y = p.y + py * p.z;
            let alpha, r = dr, g = dg, b = db;
            if (lit) {
                tint[0] = dr; tint[1] = dg; tint[2] = db;
                const amount = shade(x, y, tint);
                if (amount < 0.015)
                    continue;
                alpha = Math.min(1, amount * 1.45) * (0.3 + 0.7 * p.z) * (0.55 + 0.45 * Math.sin(p.tw));
                r = (tint[0] + dr) / 2; g = (tint[1] + dg) / 2; b = (tint[2] + db) / 2;
            }
            else {
                alpha = 0.16 * p.z * (0.6 + 0.4 * Math.sin(p.tw));
            }
            if (p.mote) {
                ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(alpha * 0.22).toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(x, y, p.mote * (0.6 + p.z * 0.6), 0, tau);
                ctx.fill();
                continue;
            }
            const size = 0.5 + p.z * 1.7;
            ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
            if (size < 1.1)
                ctx.fillRect(x, y, size, size);
            else {
                ctx.beginPath();
                ctx.arc(x, y, size / 2, 0, tau);
                ctx.fill();
            }
        }
    };

    const litColor = (x, y, base, floor) => {
        if (!state.lighting)
            return [base[0], base[1], base[2], floor + (1 - floor) * 0.45];
        tint[0] = base[0]; tint[1] = base[1]; tint[2] = base[2];
        const amount = shade(x, y, tint);
        const mix = amount * 0.6;
        return [
            base[0] * (1 - mix) + tint[0] * mix,
            base[1] * (1 - mix) + tint[1] * mix,
            base[2] * (1 - mix) + tint[2] * mix,
            floor + (1 - floor) * amount
        ];
    };

    const drawSnow = (dt, speed) => {
        const base = state.light ? state.dust : [255, 255, 255];
        for (const p of particles) {
            if (speed) {
                p.sway += p.sways * dt * speed;
                p.y += (0.25 + p.z * 0.9) * dt * 0.06 * speed;
                p.x += (Math.sin(p.sway) * 0.35 + 0.12) * p.z * dt * 0.06 * speed;
                if (p.y > h + 6 || p.x > w + 6)
                    Object.assign(p, spawn.snow(true));
            }
            const [r, g, b, a] = litColor(p.x, p.y, base, 0.28);
            ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(a * (0.35 + 0.6 * p.z)).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 0.6 + p.z * 2.1, 0, tau);
            ctx.fill();
        }
    };

    const drawRain = (dt, speed) => {
        const base = state.light ? state.dust : [190, 210, 235];
        ctx.lineCap = "round";
        for (const p of particles) {
            const vy = 7 + p.z * 11, vx = -1.6 - p.z;
            if (speed) {
                p.y += vy * dt * 0.06 * speed;
                p.x += vx * dt * 0.06 * speed;
                if (p.y > h + 30)
                    Object.assign(p, spawn.rain(true));
            }
            const len = 8 + p.z * 20;
            const [r, g, b, a] = litColor(p.x, p.y, base, 0.22);
            ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${(a * (0.18 + 0.4 * p.z)).toFixed(3)})`;
            ctx.lineWidth = 0.6 + p.z * 0.9;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - vx * len / vy, p.y - len);
            ctx.stroke();
        }
    };

    const ember = (life) => life < 0.25
        ? [255, 236, 190]
        : life < 0.6
            ? [255, 160 - (life - 0.25) * 160, 50]
            : [220 - (life - 0.6) * 200, 60 - (life - 0.6) * 80, 20];

    const drawSparks = (dt, speed) => {
        const glow = ctx.createLinearGradient(0, h, 0, h * 0.62);
        glow.addColorStop(0, "rgba(255,90,20,0.16)");
        glow.addColorStop(1, "rgba(255,90,20,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, h * 0.62, w, h * 0.38);
        ctx.globalCompositeOperation = "lighter";
        for (const p of particles) {
            if (speed) {
                p.life += p.decay * dt * 0.06 * speed;
                p.vx += (Math.random() - 0.5) * 0.08 + Math.sin(p.y * 0.01 + clock * 0.001) * 0.01;
                p.vx *= 0.97;
                p.x += p.vx * dt * 0.06 * speed;
                p.y -= (0.7 + p.z * 1.9) * dt * 0.06 * speed;
                p.fl += 0.2 * speed;
                if (p.life >= 1 || p.y < -10)
                    Object.assign(p, spawn.sparks(true));
            }
            const [r, g, b] = ember(p.life);
            const flicker = 0.7 + 0.3 * Math.sin(p.fl);
            let a = (1 - p.life) * flicker * (0.5 + 0.5 * p.z);
            if (state.lighting) {
                tint[0] = r; tint[1] = g; tint[2] = b;
                a *= 0.55 + 0.45 * shade(p.x, p.y, tint);
            }
            const size = 0.6 + p.z * 1.8;
            ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(a * 0.18).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size * 3.2, 0, tau);
            ctx.fill();
            ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, tau);
            ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
    };

    const painters = { dust: drawDust, snow: drawSnow, rain: drawRain, sparks: drawSparks };

    const paint = (dt, speed) => {
        ctx.clearRect(0, 0, w, h);
        if (state.mode === "plain")
            return;
        placeLights(clock);
        if (state.mode === "dust")
            ctx.globalCompositeOperation = "lighter";
        painters[state.mode](dt, speed);
        ctx.globalCompositeOperation = "source-over";
    };

    const tick = (now) => {
        frame = 0;
        if (!state.active || document.hidden)
            return;
        const [, speed, fps] = motionProfile[state.motion];
        if (!speed || state.mode === "plain") {
            paint(0, 0);
            return;
        }
        const minGap = 1000 / fps - 2;
        const dt = last ? Math.min(64, now - last) : 16;
        if (now - last >= minGap) {
            last = now;
            clock += dt * speed;
            paint(dt, speed);
        }
        frame = requestAnimationFrame(tick);
    };

    const start = () => {
        if (frame)
            cancelAnimationFrame(frame);
        last = 0;
        frame = requestAnimationFrame(tick);
    };

    addEventListener("resize", () => {
        resize();
        start();
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden)
            start();
    });

    // Start the lights somewhere other than dead centre.
    clock = Math.random() * 400000;
    resize();

    return {
        configure(options) {
            const previousMode = state.mode, previousMotion = state.motion;
            Object.assign(state, options);
            if (options.theme) {
                const theme = options.theme;
                state.light = theme.light;
                state.dust = hexToRgb(theme.dust);
                state.lightColors = [hexToRgb(theme.accent), hexToRgb(theme.accent2), hexToRgb(theme.dust)];
            }
            canvas.classList.toggle("is-light", state.light);
            if (state.mode !== previousMode || state.motion !== previousMotion)
                resize();
            start();
        },
        setActive(active) {
            if (state.active === active)
                return;
            state.active = active;
            if (active)
                start();
        }
    };
};
