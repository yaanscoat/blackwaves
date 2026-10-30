import { render } from "preact";
import "./styles/base.css";
import "./styles/glass.css";
import "./styles/topbar.css";
import "./styles/app.css";
import { initStorage, storage } from "./lib/storage.js";
import { loadSettings, startApplyingSettings } from "./lib/settings.js";
import { loadNotifications } from "./lib/notify.js";
import { loadGameLists } from "./lib/games/catalog.js";
import { loadSecrets, initEasterEggs } from "./lib/easter.js";
import { loadMusicState } from "./lib/player.js";
import { initCloak } from "./lib/cloak.js";
import { initOverlay } from "./lib/fx/overlay.js";
import { initCursors } from "./lib/cursors.js";
import { initSearchLight } from "./lib/fx/searchlight.js";
import { initSheen, refreshLenses } from "./lib/fx/lens.js";
import { effect } from "@preact/signals";
import { settings } from "./lib/settings.js";
import { connect } from "./lib/realtime.js";
import { refreshMe, me } from "./lib/account.js";
import { loadConsent, consent } from "./components/Welcome.jsx";
import { loadServerInfo } from "./components/StatusCorner.jsx";
import { App } from "./App.jsx";

async function boot() {
  try {
    await initStorage();
  } catch (error) {
    // no webcrypto (ancient browser or http on a weird host). run unencrypted in memory.
    console.warn("storage encryption unavailable", error);
  }
  loadSettings();
  startApplyingSettings();
  loadNotifications();
  loadGameLists();
  loadSecrets();
  loadMusicState();
  loadConsent();
  initCloak();
  initOverlay();
  initCursors();
  initSearchLight();
  initSheen();
  effect(() => {
    void settings.value.glassRefraction;
    refreshLenses();
  });
  initEasterEggs();

  // refraction only works in chromium, everyone else gets plain frosted glass
  const chromium = navigator.userAgentData?.brands?.some((brand) => /Chromium|Google Chrome|Microsoft Edge/.test(brand.brand));
  document.documentElement.dataset.liquid = chromium ? "on" : "off";

  render(<App />, document.getElementById("app"));
  document.getElementById("boot")?.remove();

  void loadServerInfo();
  // people who use the browser get scramjet + the transport warmed up while
  // they're still on the home page. everyone else skips the ~4mb download.
  if (storage.get("browserUsed")) {
    const warm = () => import("./lib/proxy.js").then((module) => module.proxyReady()).catch(() => {});
    if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2500);
  }
  void refreshMe().then(() => {
    // anonymous visitors who opted out of the counter don't open a socket at all
    if (consent.value?.presence !== false || me.value) connect();
  });
}

void boot();
