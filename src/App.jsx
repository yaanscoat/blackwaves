import { useEffect, useState } from "preact/hooks";
import { TopBar, useShortcuts } from "./components/TopBar.jsx";
import { Background } from "./components/Background.jsx";
import { GlassDefs } from "./components/GlassDefs.jsx";
import { Toasts } from "./components/Toasts.jsx";
import { StatusCorner } from "./components/StatusCorner.jsx";
import { Downloads } from "./components/Downloads.jsx";
import { Welcome } from "./components/Welcome.jsx";
import { Settings } from "./components/Settings.jsx";
import { AuthModal } from "./components/AuthModal.jsx";
import { ProfileCardHost } from "./components/ProfileCard.jsx";
import { MiniPlayer } from "./components/MiniPlayer.jsx";
import { Home } from "./pages/Home.jsx";
import { Browser } from "./pages/Browser.jsx";
import { route, section, navigate } from "./lib/router.js";
import { browserVisited } from "./lib/browser.js";
import { settings } from "./lib/settings.js";

// everything that isn't the home page or the browser loads on demand.
// (we tried preact's lazy + Suspense first. it left old pages lying around in
// the DOM, so the shop and the chat would stack on the home page. cursed. this is simpler.)
const LOADERS = {
  games: () => import("./pages/Games.jsx").then((m) => m.Games),
  movies: () => import("./pages/Movies.jsx").then((m) => m.Movies),
  music: () => import("./pages/Music.jsx").then((m) => m.Music),
  manga: () => import("./pages/Manga.jsx").then((m) => m.Manga),
  cloud: () => import("./pages/Cloud.jsx").then((m) => m.Cloud),
  chat: () => import("./pages/Chat.jsx").then((m) => m.Chat),
  ai: () => import("./pages/AI.jsx").then((m) => m.AI),
  shop: () => import("./pages/Shop.jsx").then((m) => m.Shop),
  profile: () => import("./pages/Profile.jsx").then((m) => m.Profile),
  u: () => import("./pages/Profile.jsx").then((m) => m.Profile),
  legal: () => import("./pages/Legal.jsx").then((m) => m.Legal),
};
const loaded = {};

function AsyncPage({ name }) {
  const [Page, setPage] = useState(() => loaded[name] || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded[name]) return;
    let alive = true;
    LOADERS[name]()
      .then((component) => {
        loaded[name] = component;
        if (alive) setPage(() => component);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [name]);
  if (failed) {
    return (
      <main class="page">
        <div class="empty">
          <p>This page didn't load. Check your connection and try again.</p>
          <button class="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
  return Page ? <Page /> : <PageFallback />;
}

function PageFallback() {
  return (
    <main class="page page-loading">
      <div class="spinner" />
    </main>
  );
}

function NotFound() {
  return (
    <main class="page">
      <div class="empty">
        <img class="logo-img" src="/favicon.ico" alt="" width="80" />
        <h1>Lost at sea</h1>
        <p>There's nothing at this address.</p>
        <button class="btn primary" onClick={() => navigate("/")}>
          Back home
        </button>
      </div>
    </main>
  );
}

export function App() {
  useShortcuts();
  const current = section(route.value);
  const onBrowser = current === "browser";
  const browserMode = settings.value.browserMode;

  // browser mode opens straight into the browser
  useEffect(() => {
    if (browserMode && current === "home") navigate("/browser", { replace: true });
  }, [browserMode]);

  useEffect(() => {
    document.documentElement.dataset.route = current;
    if (onBrowser) browserVisited.value = true;
  }, [current]);

  const hasPage = Boolean(LOADERS[current]);

  return (
    <>
      <GlassDefs />
      <Background />
      <TopBar />
      {current === "home" && <Home />}
      {(browserVisited.value || onBrowser) && <Browser visible={onBrowser} />}
      {hasPage && <AsyncPage key={current} name={current} />}
      {!hasPage && current !== "home" && !onBrowser && <NotFound />}
      <MiniPlayer />
      {!onBrowser && current !== "chat" && current !== "music" && current !== "ai" && <StatusCorner />}
      <Downloads />
      <Toasts />
      <Settings />
      <AuthModal />
      <ProfileCardHost />
      {current !== "legal" && <Welcome />}
    </>
  );
}
