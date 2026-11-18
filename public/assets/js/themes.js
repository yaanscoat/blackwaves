/* Themes, motion levels and seasonal effects. Loaded in <head> so the theme applies before first paint. */
(function () {
  const THEMES = [
    { id: 'midnight', name: 'Midnight', colors: ['#050507', '#121217', '#ffffff'] },
    { id: 'nord', name: 'Nord', colors: ['#2e3440', '#3b4252', '#88c0d0'] },
    { id: 'mint', name: 'Mint', colors: ['#0b1512', '#13241e', '#6ee7b7'] },
    { id: 'dracula', name: 'Dracula', colors: ['#1e1f29', '#282a36', '#bd93f9'] },
    { id: 'catppuccin', name: 'Catppuccin', colors: ['#1e1e2e', '#28283d', '#f5c2e7'] },
    { id: 'gruvbox', name: 'Gruvbox', colors: ['#1d2021', '#282828', '#fabd2f'] },
    { id: 'tokyo', name: 'Tokyo Night', colors: ['#1a1b26', '#24283b', '#7aa2f7'] },
    { id: 'solarized', name: 'Solarized', colors: ['#002b36', '#073642', '#2aa198'] },
    { id: 'rosepine', name: 'Rosé Pine', colors: ['#191724', '#1f1d2e', '#ebbcba'] },
    { id: 'ocean', name: 'Ocean', colors: ['#04121f', '#0a1f33', '#38bdf8'] },
    { id: 'sunset', name: 'Sunset', colors: ['#1a0f14', '#27161d', '#fb923c'] },
    { id: 'forest', name: 'Forest', colors: ['#0e140d', '#172015', '#a3e635'] },
    { id: 'lavender', name: 'Lavender', colors: ['#15121f', '#1f1a2e', '#c4b5fd'] },
    { id: 'crimson', name: 'Crimson', colors: ['#120708', '#1f0d10', '#fb7185'] },
    { id: 'paper', name: 'Paper', colors: ['#f6f5f1', '#ffffff', '#1c1c1f'] },
  ];

  const MOTION = [
    { id: 'full', name: 'Full' },
    { id: 'minimal', name: 'Minimal' },
    { id: 'reduced', name: 'Reduced' },
    { id: 'off', name: 'Off' },
  ];

  const SEASONAL = [
    { id: 'auto', name: 'Automatic (by date)' },
    { id: 'none', name: 'None' },
    { id: 'christmas', name: 'Christmas' },
    { id: 'snow', name: 'Snowfall' },
    { id: 'autumn', name: 'Autumn leaves' },
    { id: 'sakura', name: 'Sakura petals' },
    { id: 'halloween', name: 'Halloween' },
    { id: 'valentine', name: 'Valentine hearts' },
    { id: 'newyear', name: 'New Year fireworks' },
    { id: 'rain', name: 'Spring rain' },
    { id: 'fireflies', name: 'Summer fireflies' },
    { id: 'stars', name: 'Starry night' },
  ];

  const root = document.documentElement;

  function applyTheme(id) {
    if (!THEMES.some((t) => t.id === id)) id = 'midnight';
    root.dataset.theme = id;
    const meta = document.querySelector('meta[name="theme-color"]');
    const theme = THEMES.find((t) => t.id === id);
    if (meta) meta.content = theme.colors[0];
    if (seasonal.current() === 'stars') seasonal.restart(); // star colour follows light/dark
  }

  function applyMotion(id) {
    root.dataset.motion = MOTION.some((m) => m.id === id) ? id : 'full';
    seasonal.restart();
  }

  // [from month, day, to month, day, effect]; any date outside these windows gets the starry night
  const SEASONS = [
    [1, 1, 1, 7, 'newyear'],
    [1, 8, 1, 31, 'snow'],
    [2, 7, 2, 14, 'valentine'],
    [3, 20, 4, 25, 'sakura'],
    [6, 21, 8, 20, 'fireflies'],
    [9, 22, 10, 14, 'autumn'],
    [10, 15, 10, 31, 'halloween'],
    [11, 1, 11, 15, 'autumn'],
    [12, 1, 12, 31, 'christmas'],
  ];
  function seasonForDate(d = new Date()) {
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    const season = SEASONS.find(([fm, fd, tm, td]) => md >= fm * 100 + fd && md <= tm * 100 + td);
    return season ? season[4] : 'stars';
  }

  /* ---------------- Seasonal particle engine ---------------- */
  const seasonal = (() => {
    let canvas, ctx, raf, particles = [], effect = 'none', last = 0, w = 0, h = 0, dpr = 1, lightTheme = false;

    const PRESETS = {
      snow: { count: 90, spawn: snowflake },
      christmas: { count: 80, spawn: snowflake },
      autumn: { count: 34, spawn: leaf },
      sakura: { count: 45, spawn: petal },
      halloween: { count: 40, spawn: ember },
      valentine: { count: 26, spawn: heart },
      newyear: { count: 0, spawn: null },
      rain: { count: 110, spawn: raindrop },
      fireflies: { count: 40, spawn: firefly },
      stars: { count: 170, spawn: star },
    };

    const rand = (a, b) => a + Math.random() * (b - a);

    function snowflake(initial) {
      return { kind: 'snow', x: rand(0, w), y: initial ? rand(0, h) : -10, r: rand(1, 3.2), vy: rand(20, 55), vx: rand(-12, 12), phase: rand(0, 6.28), a: rand(0.35, 0.9) };
    }
    function leaf(initial) {
      const palette = ['#d9622b', '#e8a33d', '#b5452b', '#c97a2b', '#8f3b1b'];
      return { kind: 'leaf', x: rand(0, w), y: initial ? rand(0, h) : -20, s: rand(7, 13), vy: rand(30, 60), vx: rand(-15, 15), rot: rand(0, 6.28), vr: rand(-1.5, 1.5), phase: rand(0, 6.28), color: palette[Math.floor(Math.random() * palette.length)], a: rand(0.6, 0.95) };
    }
    function petal(initial) {
      const palette = ['#ffc4d6', '#ffb0c8', '#fbd3e0', '#f7a6c0'];
      return { kind: 'petal', x: rand(-50, w), y: initial ? rand(0, h) : -15, s: rand(5, 9), vy: rand(25, 50), vx: rand(10, 35), rot: rand(0, 6.28), vr: rand(-2, 2), phase: rand(0, 6.28), color: palette[Math.floor(Math.random() * palette.length)], a: rand(0.6, 0.95) };
    }
    function ember(initial) {
      return { kind: 'ember', x: rand(0, w), y: initial ? rand(0, h) : h + 10, r: rand(1, 2.6), vy: -rand(15, 40), vx: rand(-8, 8), phase: rand(0, 6.28), color: Math.random() < 0.7 ? '#ff8a1f' : '#a855f7', a: rand(0.4, 0.9) };
    }
    function heart(initial) {
      const palette = ['#ff5d8f', '#ff8fab', '#ffb3c6', '#e63973'];
      return { kind: 'heart', x: rand(0, w), y: initial ? rand(0, h) : h + 20, s: rand(6, 12), vy: -rand(20, 45), vx: rand(-6, 6), phase: rand(0, 6.28), color: palette[Math.floor(Math.random() * palette.length)], a: rand(0.4, 0.85) };
    }
    function raindrop(initial) {
      return { kind: 'rain', x: rand(0, w + 100), y: initial ? rand(0, h) : -20, l: rand(10, 22), vy: rand(500, 800), vx: -60, a: rand(0.15, 0.4) };
    }
    function firefly(initial) {
      return { kind: 'firefly', x: rand(0, w), y: rand(h * 0.3, h), r: rand(1.2, 2.4), vx: rand(-10, 10), vy: rand(-10, 10), phase: rand(0, 6.28), a: 0 };
    }
    function star() {
      const warm = Math.random() < 0.15;
      const color = lightTheme ? (warm ? '#8a6a2f' : '#3b3b4a') : warm ? '#ffe6b8' : Math.random() < 0.2 ? '#c8d8ff' : '#ffffff';
      return { kind: 'star', x: rand(0, w), y: rand(0, h), r: rand(0.35, 1.5), base: rand(0.25, 0.85), tw: rand(0.6, 2.2), phase: rand(0, 6.28), color };
    }
    function shootingStar() {
      const ang = rand(0.35, 0.65), sp = rand(500, 800);
      particles.push({ kind: 'shoot', x: rand(w * 0.1, w * 0.9), y: rand(0, h * 0.4), vx: Math.cos(ang) * sp * (Math.random() < 0.5 ? -1 : 1), vy: Math.sin(ang) * sp, life: rand(0.6, 1.1), age: 0 });
    }
    function drawStar(p, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.r > 1.2) {
        // a faint cross glint on the brightest stars
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillRect(p.x - p.r * 3, p.y - 0.25, p.r * 6, 0.5);
        ctx.fillRect(p.x - 0.25, p.y - p.r * 3, 0.5, p.r * 6);
      }
    }
    function burst() {
      const x = rand(w * 0.15, w * 0.85), y = rand(h * 0.1, h * 0.5);
      const hue = Math.floor(rand(0, 360));
      const n = densityScale() < 0.5 ? 24 : 46;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2, sp = rand(60, 160);
        particles.push({ kind: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(1, 1.8), age: 0, color: `hsl(${hue + rand(-20, 20)},90%,65%)` });
      }
    }

    function densityScale() {
      return { full: 1, minimal: 0.6, reduced: 0.3, off: 0 }[root.dataset.motion] ?? 1;
    }
    function speedScale() {
      return root.dataset.motion === 'reduced' ? 0.5 : 1;
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawLeaf(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, -p.s);
      ctx.quadraticCurveTo(p.s * 0.9, -p.s * 0.2, 0, p.s);
      ctx.quadraticCurveTo(-p.s * 0.9, -p.s * 0.2, 0, -p.s);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,20,5,0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -p.s);
      ctx.lineTo(0, p.s * 1.25);
      ctx.stroke();
      ctx.restore();
    }
    function drawPetal(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    function drawHeart(p) {
      const s = p.s;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.45, -s, 0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.45, -s, s, -s * 0.3, 0, s * 0.35);
      ctx.fill();
      ctx.restore();
    }

    function frame(t) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((t - last) / 1000, 0.05) * speedScale();
      last = t;
      ctx.clearRect(0, 0, w, h);
      const preset = PRESETS[effect];
      if (!preset) return;

      if (effect === 'newyear' && Math.random() < dt * 0.9 * densityScale() + 0.002) burst();
      if (effect === 'stars' && Math.random() < dt * 0.08 * densityScale()) shootingStar();
      const target = Math.round(preset.count * densityScale());
      while (preset.spawn && particles.length < target) particles.push(preset.spawn(false));

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.phase = (p.phase || 0) + dt;
        switch (p.kind) {
          case 'snow':
            p.x += (p.vx + Math.sin(p.phase) * 10) * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = p.a;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'leaf':
          case 'petal':
            p.x += (p.vx + Math.sin(p.phase * 1.3) * 25) * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            p.kind === 'leaf' ? drawLeaf(p) : drawPetal(p);
            break;
          case 'ember':
            p.x += (p.vx + Math.sin(p.phase * 2) * 8) * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(p.phase * 4));
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            break;
          case 'heart':
            p.x += (p.vx + Math.sin(p.phase * 1.5) * 12) * dt;
            p.y += p.vy * dt;
            drawHeart(p);
            break;
          case 'rain':
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = p.a;
            ctx.strokeStyle = '#9ec5ff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.vx * 0.02, p.y + p.l);
            ctx.stroke();
            break;
          case 'firefly':
            p.vx += rand(-20, 20) * dt;
            p.vy += rand(-20, 20) * dt;
            p.vx = Math.max(-15, Math.min(15, p.vx));
            p.vy = Math.max(-15, Math.min(15, p.vy));
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.sin(p.phase * 1.5));
            ctx.fillStyle = '#e8ff8a';
            ctx.shadowColor = '#e8ff8a';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) particles[i] = firefly(true);
            continue;
          case 'star':
            drawStar(p, p.base * (0.55 + 0.45 * Math.sin(p.phase * p.tw)));
            continue;
          case 'shoot': {
            p.age += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            const fade = Math.max(0, 1 - p.age / p.life);
            const trail = ctx.createLinearGradient(p.x, p.y, p.x - p.vx * 0.12, p.y - p.vy * 0.12);
            const rgb = lightTheme ? '59,59,74' : '255,255,255';
            trail.addColorStop(0, `rgba(${rgb},0.9)`);
            trail.addColorStop(1, `rgba(${rgb},0)`);
            ctx.globalAlpha = fade;
            ctx.strokeStyle = trail;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 0.12, p.y - p.vy * 0.12);
            ctx.stroke();
            if (p.age >= p.life) particles.splice(i, 1);
            continue;
          }
          case 'spark':
            p.age += dt;
            p.vy += 70 * dt;
            p.vx *= 0.985;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, 2, 2);
            if (p.age >= p.life) particles.splice(i, 1);
            continue;
        }
        if (p.y > h + 30 || p.y < -40 || p.x > w + 120 || p.x < -120) {
          particles.splice(i, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    function decor(id) {
      const el = document.getElementById('seasonal-decor');
      if (!el) return;
      el.className = '';
      el.innerHTML = '';
      if (id === 'christmas') {
        el.className = 'decor-lights';
        const colors = ['#ff4d4d', '#ffd84d', '#4dff88', '#4dc3ff', '#ff4dd8'];
        const count = Math.ceil(window.innerWidth / 46);
        for (let i = 0; i < count; i++) {
          const b = document.createElement('span');
          b.style.setProperty('--c', colors[i % colors.length]);
          b.style.animationDelay = `${(i % 5) * 0.3}s`;
          el.appendChild(b);
        }
      }
      root.dataset.season = id;
    }

    function start(id) {
      canvas = canvas || document.getElementById('seasonal-canvas');
      if (!canvas) return;
      ctx = ctx || canvas.getContext('2d');
      cancelAnimationFrame(raf);
      particles = [];
      effect = id === 'auto' ? seasonForDate() : id;
      lightTheme = getComputedStyle(root).getPropertyValue('--scheme').trim() === 'light';
      decor(effect);
      if (effect === 'stars' && densityScale() === 0) {
        // motion off: the night sky still shows, it just holds still
        resize();
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < 120; i++) {
          const p = star();
          drawStar(p, p.base);
        }
        ctx.globalAlpha = 1;
        return;
      }
      if (effect === 'none' || densityScale() === 0) {
        ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      resize();
      const preset = PRESETS[effect];
      if (preset && preset.spawn) {
        const n = Math.round(preset.count * densityScale());
        for (let i = 0; i < n; i++) particles.push(preset.spawn(true));
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    window.addEventListener('resize', () => {
      if (canvas && effect === 'stars') start(BW.settings.get('seasonal')); // re-scatter the sky
      else if (canvas && effect !== 'none') {
        resize();
        decor(effect);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (canvas) start(BW.settings.get('seasonal'));
    });

    return {
      start,
      restart() {
        if (canvas) start(BW.settings.get('seasonal'));
      },
      pause() {
        cancelAnimationFrame(raf);
        ctx && ctx.clearRect(0, 0, w, h);
      },
      current: () => effect,
    };
  })();

  const applyCursor = (on) => (root.dataset.cursor = on ? 'custom' : 'system');

  applyTheme(BW.settings.get('theme'));
  applyCursor(BW.settings.get('customCursor'));
  BW.settings.on('customCursor', applyCursor);
  root.dataset.motion = BW.settings.get('motion');
  BW.settings.on('theme', applyTheme);
  BW.settings.on('motion', applyMotion);
  BW.settings.on('seasonal', (v) => seasonal.start(v));
  document.addEventListener('DOMContentLoaded', () => seasonal.start(BW.settings.get('seasonal')));

  Object.assign(BW, { THEMES, MOTION, SEASONAL, seasonal, applyTheme, seasonForDate });
})();
