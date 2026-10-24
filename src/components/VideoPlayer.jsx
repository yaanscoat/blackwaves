// the blackwaves video player: hls.js underneath, liquid glass on top.
// controls hide while you watch, a netflix-style info card shows up when you
// pause, and every control has a keyboard shortcut (press ? to see them).
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { storage } from "../lib/storage.js";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoPlayer({ src, title, subtitle = "", meta = {}, startAt = 0, onProgress, onFail, onEnded, downloadUrl }) {
  const wrap = useRef(null);
  const video = useRef(null);
  const hlsRef = useRef(null);
  const hideTimer = useRef(0);
  const pauseTimer = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolumeState] = useState(() => storage.get("videoVolume", 1));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1);
  const [menu, setMenu] = useState(null); // "speed" | "quality" | "keys"
  const [chrome, setChrome] = useState(true);
  const [paused, setPaused] = useState(false); // shows the info card after a short pause
  const [waiting, setWaiting] = useState(true);
  const [hover, setHover] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [flash, setFlash] = useState(null);

  // ---- load the stream -------------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    let cancelled = false;
    setWaiting(true);
    (async () => {
      if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = src;
      } else {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (!Hls.isSupported()) return onFail?.();
        const hls = new Hls({ maxBufferLength: 40, maxMaxBufferLength: 90, startLevel: -1, capLevelToPlayerSize: true });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(el);
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => setLevels(data.levels.map((entry, index) => ({ index, height: entry.height, bitrate: entry.bitrate }))));
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => hls.autoLevelEnabled || setLevel(data.level));
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else onFail?.();
        });
      }
      el.volume = volume;
      if (startAt > 5) el.currentTime = startAt;
      el.play().catch(() => {});
    })();
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  // ---- video element events --------------------------------------------------------
  useEffect(() => {
    const el = video.current;
    let lastSaved = 0;
    const handlers = {
      play: () => {
        setPlaying(true);
        setPaused(false);
        clearTimeout(pauseTimer.current);
      },
      pause: () => {
        setPlaying(false);
        clearTimeout(pauseTimer.current);
        pauseTimer.current = setTimeout(() => setPaused(true), 1400);
      },
      timeupdate: () => {
        setTime(el.currentTime);
        if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
        if (Math.abs(el.currentTime - lastSaved) > 10) {
          lastSaved = el.currentTime;
          onProgress?.(el.currentTime, el.duration);
        }
      },
      durationchange: () => setDuration(el.duration),
      waiting: () => setWaiting(true),
      playing: () => setWaiting(false),
      canplay: () => setWaiting(false),
      ended: () => onEnded?.(),
      volumechange: () => {
        setMuted(el.muted);
        setVolumeState(el.volume);
      },
      ratechange: () => setSpeedState(el.playbackRate),
    };
    for (const [name, fn] of Object.entries(handlers)) el.addEventListener(name, fn);
    const onFs = () => setFullscreen(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      for (const [name, fn] of Object.entries(handlers)) el.removeEventListener(name, fn);
      document.removeEventListener("fullscreenchange", onFs);
      onProgress?.(el.currentTime, el.duration);
    };
  }, []);

  // ---- controls auto-hide ------------------------------------------------------------
  const poke = () => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => !video.current?.paused && !menu && setChrome(false), 2600);
  };
  useEffect(() => {
    if (!playing || menu) setChrome(true);
    else poke();
    return () => clearTimeout(hideTimer.current);
  }, [playing, menu]);

  // ---- actions -------------------------------------------------------------------------
  const el = () => video.current;
  const showFlash = (icon, label) => {
    setFlash({ icon, label, key: Date.now() });
  };
  const toggle = () => {
    if (el().paused) {
      el().play().catch(() => {});
      showFlash("play");
    } else {
      el().pause();
      showFlash("pause");
    }
  };
  const skip = (seconds) => {
    el().currentTime = Math.max(0, Math.min(el().duration || 0, el().currentTime + seconds));
    showFlash(seconds > 0 ? "forward" : "back", `${seconds > 0 ? "+" : ""}${seconds}s`);
    poke();
  };
  const setVolume = (value) => {
    el().volume = Math.max(0, Math.min(1, value));
    el().muted = value <= 0;
    storage.set("videoVolume", el().volume);
  };
  const setSpeed = (value) => {
    el().playbackRate = value;
    showFlash("zap", `${value}x`);
  };
  const setQuality = (index) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
      setLevel(index);
    }
    setMenu(null);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.current?.requestFullscreen?.();
  };
  const pip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el().requestPictureInPicture();
    } catch {}
  };

  // ---- keyboard ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!wrap.current?.isConnected) return;
      const key = event.key.toLowerCase();
      const actions = {
        " ": toggle,
        k: toggle,
        j: () => skip(-10),
        l: () => skip(10),
        arrowleft: () => skip(-5),
        arrowright: () => skip(5),
        arrowup: () => (setVolume(el().volume + 0.1), showFlash("volume", `${Math.round(el().volume * 100)}%`)),
        arrowdown: () => (setVolume(el().volume - 0.1), showFlash("volume", `${Math.round(el().volume * 100)}%`)),
        m: () => ((el().muted = !el().muted), showFlash(el().muted ? "mute" : "volume")),
        f: toggleFullscreen,
        p: pip,
        ">": () => setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(el().playbackRate) + 1)] || 1),
        "<": () => setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(el().playbackRate) - 1)] || 1),
        "?": () => setMenu(menu === "keys" ? null : "keys"),
      };
      if (/^[0-9]$/.test(key) && el().duration) {
        el().currentTime = (Number(key) / 10) * el().duration;
        event.preventDefault();
        return;
      }
      const action = actions[key] || actions[event.key];
      if (action) {
        event.preventDefault();
        action();
        poke();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const seekFrom = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (duration || 0);
  };
  const progressPct = duration ? (time / duration) * 100 : 0;
  const bufferPct = duration ? (buffered / duration) * 100 : 0;
  const volumeIcon = muted || volume === 0 ? "mute" : "volume";

  return (
    <div
      ref={wrap}
      class={`vp ${chrome ? "show" : "hide"} ${paused ? "is-paused" : ""} ${fullscreen ? "fs" : ""}`}
      onPointerMove={poke}
      onPointerLeave={() => playing && !menu && setChrome(false)}
    >
      <video ref={video} class="vp-video" playsInline onClick={toggle} onDblClick={toggleFullscreen} />

      {waiting && !paused && (
        <div class="vp-center">
          <span class="vp-spinner" />
        </div>
      )}

      {flash && (
        <div class="vp-flash" key={flash.key}>
          <span class="glass liquid">
            <Icon name={flash.icon} size={26} fill={flash.icon === "play" || flash.icon === "pause"} />
            {flash.label && <span>{flash.label}</span>}
          </span>
        </div>
      )}

      {/* the pause screen: what you're watching, in big letters */}
      <div class="vp-info" aria-hidden={!paused} onClick={toggle}>
        <div class="vp-info-text">
          <span class="vp-kicker">You're watching</span>
          <h2>{title}</h2>
          {subtitle && <h3>{subtitle}</h3>}
          <p class="vp-facts">{[meta.year, meta.runtime, meta.rating && `★ ${meta.rating}`, meta.genres].filter(Boolean).join("  ·  ")}</p>
          {meta.overview && <p class="vp-overview">{meta.overview}</p>}
          <span class="vp-resume">
            <Icon name="play" size={14} fill /> Paused at {clock(time)} of {clock(duration)}
          </span>
        </div>
      </div>

      <div class="vp-top">
        <span class="vp-title">
          {title}
          {subtitle && <span class="faint"> · {subtitle}</span>}
        </span>
      </div>

      <div class="vp-bar glass liquid" onPointerDown={(event) => event.stopPropagation()}>
        <div
          class="vp-progress"
          onPointerMove={(event) => setHover({ x: event.clientX - event.currentTarget.getBoundingClientRect().left, t: seekFrom(event) })}
          onPointerLeave={() => setHover(null)}
          onClick={(event) => {
            el().currentTime = seekFrom(event);
            poke();
          }}
        >
          <span class="vp-buffer" style={{ width: `${bufferPct}%` }} />
          <span class="vp-played" style={{ width: `${progressPct}%` }} />
          <span class="vp-knob" style={{ left: `${progressPct}%` }} />
          {hover && (
            <span class="vp-hover-time" style={{ left: `${hover.x}px` }}>
              {clock(hover.t)}
            </span>
          )}
        </div>
        <div class="vp-row">
          <button class="vp-btn" aria-label={playing ? "Pause" : "Play"} data-tip={playing ? "Pause (k)" : "Play (k)"} data-tip-pos="up" onClick={toggle}>
            <Icon name={playing ? "pause" : "play"} size={22} fill />
          </button>
          <button class="vp-btn" aria-label="Back 10 seconds" data-tip="Back 10s (j)" data-tip-pos="up" onClick={() => skip(-10)}>
            <Icon name="back" size={19} />
          </button>
          <button class="vp-btn" aria-label="Forward 10 seconds" data-tip="Forward 10s (l)" data-tip-pos="up" onClick={() => skip(10)}>
            <Icon name="forward" size={19} />
          </button>
          <div class="vp-volume">
            <button class="vp-btn" aria-label={muted ? "Unmute" : "Mute"} data-tip="Mute (m)" data-tip-pos="up" onClick={() => (el().muted = !el().muted)}>
              <Icon name={volumeIcon} size={20} />
            </button>
            <input
              class="vp-range"
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={muted ? 0 : volume}
              style={{ "--fill": `${(muted ? 0 : volume) * 100}%` }}
              aria-label="Volume"
              onInput={(event) => setVolume(Number(event.currentTarget.value))}
            />
          </div>
          <span class="vp-time">
            {clock(time)} <span class="faint">/ {clock(duration)}</span>
          </span>
          <span class="vp-spacer" />
          <div class="vp-menu-wrap">
            <button class={`vp-btn vp-text ${speed !== 1 ? "on" : ""}`} aria-label="Playback speed" data-tip="Speed" data-tip-pos="up" onClick={() => setMenu(menu === "speed" ? null : "speed")}>
              {speed}x
            </button>
            {menu === "speed" && (
              <div class="vp-menu glass liquid">
                <span class="vp-menu-title">Speed</span>
                {SPEEDS.map((value) => (
                  <button key={value} class={value === speed ? "on" : ""} onClick={() => (setSpeed(value), setMenu(null))}>
                    {value === 1 ? "Normal" : `${value}x`}
                    {value === speed && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {levels.length > 1 && (
            <div class="vp-menu-wrap">
              <button class="vp-btn vp-text" aria-label="Quality" data-tip="Quality" data-tip-pos="up" onClick={() => setMenu(menu === "quality" ? null : "quality")}>
                {level === -1 ? "Auto" : `${levels.find((entry) => entry.index === level)?.height || ""}p`}
              </button>
              {menu === "quality" && (
                <div class="vp-menu glass liquid">
                  <span class="vp-menu-title">Quality</span>
                  <button class={level === -1 ? "on" : ""} onClick={() => setQuality(-1)}>
                    Auto
                    {level === -1 && <Icon name="check" size={14} />}
                  </button>
                  {[...levels].sort((a, b) => b.height - a.height).map((entry) => (
                    <button key={entry.index} class={level === entry.index ? "on" : ""} onClick={() => setQuality(entry.index)}>
                      {entry.height}p
                      {level === entry.index && <Icon name="check" size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {downloadUrl && (
            <a class="vp-btn" href={downloadUrl} download aria-label="Download" data-tip="Download" data-tip-pos="up">
              <Icon name="download" size={19} />
            </a>
          )}
          <div class="vp-menu-wrap">
            <button class="vp-btn" aria-label="Keyboard shortcuts" data-tip="Shortcuts (?)" data-tip-pos="up" onClick={() => setMenu(menu === "keys" ? null : "keys")}>
              <Icon name="info" size={19} />
            </button>
            {menu === "keys" && (
              <div class="vp-menu glass liquid vp-keys">
                <span class="vp-menu-title">Keyboard</span>
                {[
                  ["Space / K", "Play or pause"],
                  ["J / L", "Back / forward 10s"],
                  ["← / →", "Back / forward 5s"],
                  ["↑ / ↓", "Volume"],
                  ["M", "Mute"],
                  ["< / >", "Slower / faster"],
                  ["0-9", "Jump to 0%-90%"],
                  ["F", "Fullscreen"],
                  ["P", "Picture in picture"],
                ].map(([key, what]) => (
                  <span key={key} class="vp-key">
                    <span class="kbd">{key}</span>
                    <span>{what}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <button class="vp-btn" aria-label="Picture in picture" data-tip="Picture in picture (p)" data-tip-pos="up" onClick={pip}>
            <Icon name="external" size={18} />
          </button>
          <button class="vp-btn" aria-label="Fullscreen" data-tip="Fullscreen (f)" data-tip-pos="up" onClick={toggleFullscreen}>
            <Icon name={fullscreen ? "minimize" : "fullscreen"} size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
