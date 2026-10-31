import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { Icon } from "./Icon.jsx";
import { online } from "../lib/realtime.js";
import { settings } from "../lib/settings.js";
import { partyMode } from "../lib/easter.js";

export const serverInfo = signal(null);

export async function loadServerInfo() {
  try {
    const response = await fetch("/api/info");
    if (!response.ok) throw new Error(`info: ${response.status}`);
    serverInfo.value = await response.json();
    if (!online.value) online.value = serverInfo.value.online;
  } catch {
    serverInfo.value = { offline: true };
    setTimeout(loadServerInfo, 30_000);
  }
}

function flag(code) {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1a5 + char.charCodeAt(0)));
}

export function StatusCorner() {
  const [pokes, setPokes] = useState([]);
  const info = serverInfo.value;
  const s = settings.value;
  if (!s.showLocation && !s.showOnline) return null;
  const location = info?.location;
  const place = location ? [location.region, location.country].filter(Boolean).join(", ") : info?.offline ? "server offline" : "finding the server...";
  const showOnline = s.showOnline && !info?.offline;

  const poke = () => {
    const now = Date.now();
    const recent = [...pokes.filter((at) => now - at < 2500), now];
    setPokes(recent);
    if (recent.length >= 5) {
      setPokes([]);
      partyMode();
    }
  };

  return (
    <div class="status-corner glass" role="status">
      {s.showLocation && (
        <span class="status-item" data-tip="Server location" data-tip-pos="up">
          <Icon name="pin" size={14} />
          {location?.countryCode && <span aria-hidden="true">{flag(location.countryCode)}</span>}
          <span>{place}</span>
        </span>
      )}
      {s.showLocation && showOnline && <span class="status-sep" />}
      {showOnline && (
        <button class="status-item status-online" onClick={poke} data-tip="People on blackwaves right now" data-tip-pos="up">
          <span class="live-dot" />
          <span>{online.value.toLocaleString()} online</span>
        </button>
      )}
    </div>
  );
}
