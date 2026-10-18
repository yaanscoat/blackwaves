// Confetti that rains down from above the top edge, flutters, and slowly
// fades out. The canvas only exists while pieces are on screen.
const tau = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);
const festive = ["#ff5c8a", "#ffd25c", "#5ce1e6", "#9b8cff", "#7cf0a8", "#ff9f5c"];
const maxPieces = 700;

// Per motion level: pieces per burst.
const burstSize = [0, 90, 150, 220];

const themeColors = () => {
    const style = getComputedStyle(document.documentElement);
    return ["--accent", "--accent-2", "--fg"]
        .map(name => style.getPropertyValue(name).trim())
        .filter(Boolean);
};

export const createConfetti = () => {
    let canvas = null;
    let ctx = null;
    let w = 0, h = 0, dpr = 1;
    let pieces = [];
    let frame = 0;
    let last = 0;

    const resize = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = innerWidth;
        h = innerHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const mount = () => {
        if (canvas)
            return;
        canvas = document.createElement("canvas");
        canvas.className = "confetti";
        canvas.setAttribute("aria-hidden", "true");
        ctx = canvas.getContext("2d");
        document.body.append(canvas);
        resize();
        addEventListener("resize", resize);
    };

    const unmount = () => {
        removeEventListener("resize", resize);
        canvas?.remove();
        canvas = null;
        ctx = null;
    };

    const make = (colors) => {
        const shape = Math.random();
        const size = rand(5, 10);
        return {
            x: rand(-0.05, 1.05) * w,
            y: -rand(12, 90),
            vx: rand(-40, 40),
            vy: rand(40, 200),
            // Spread the shower over most of a second.
            delay: rand(0, 0.9),
            age: 0,
            // Starts fading somewhere between 2.4s and 4.4s, over 1.6s.
            fadeAt: rand(2.4, 4.4),
            fadeFor: 1.6,
            w: shape < 0.2 ? 2.4 : size,
            h: shape < 0.2 ? size * 1.8 : size * rand(0.4, 0.65),
            round: shape > 0.82,
            color: colors[Math.floor(Math.random() * colors.length)],
            spin: rand(0, tau),
            spinSpeed: rand(-6, 6),
            tilt: rand(0, tau),
            tiltSpeed: rand(4, 9),
            sway: rand(14, 38),
            swaySpeed: rand(1.4, 3.2),
            phase: rand(0, tau)
        };
    };

    const step = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000 || 0);
        last = now;
        ctx.clearRect(0, 0, w, h);
        const alive = [];
        for (const p of pieces) {
            if (p.delay > 0) {
                p.delay -= dt;
                alive.push(p);
                continue;
            }
            p.age += dt;
            // Gravity with air drag, so paper settles into a gentle fall.
            p.vy += 300 * dt;
            p.vy -= p.vy * 1.35 * dt;
            p.vx -= p.vx * 0.9 * dt;
            p.x += (p.vx + Math.sin(p.phase + p.age * p.swaySpeed) * p.sway) * dt;
            p.y += p.vy * dt;
            p.spin += p.spinSpeed * dt;
            p.tilt += p.tiltSpeed * dt;
            const fade = p.age < p.fadeAt ? 1 : 1 - (p.age - p.fadeAt) / p.fadeFor;
            if (fade <= 0 || p.y > h + 30)
                continue;
            alive.push(p);
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.spin);
            // Flipping on one axis fakes the 3D tumble.
            ctx.scale(1, Math.cos(p.tilt));
            ctx.fillStyle = p.color;
            if (p.round) {
                ctx.beginPath();
                ctx.arc(0, 0, p.w / 2.4, 0, tau);
                ctx.fill();
            }
            else
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        pieces = alive;
        if (pieces.length)
            frame = requestAnimationFrame(step);
        else {
            frame = 0;
            unmount();
        }
    };

    const burst = (motion = 3) => {
        const count = burstSize[motion] ?? burstSize[3];
        if (!count)
            return;
        mount();
        const colors = [...festive, ...themeColors()];
        const room = Math.max(0, maxPieces - pieces.length);
        for (let i = 0; i < Math.min(count, room); i++)
            pieces.push(make(colors));
        if (!frame) {
            last = performance.now();
            frame = requestAnimationFrame(step);
        }
    };

    return { burst };
};
