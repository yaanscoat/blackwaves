import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { SOURCES, loadSource, searchGames, favorites, recents, toggleFavorite, isFavorite, addRecent, normalize } from "../lib/games/catalog.js";
import { settings, setSetting } from "../lib/settings.js";
import { proxyUrl } from "../lib/gameurl.js";
import { openInBrowser } from "../lib/browser.js";
import { toast } from "../lib/notify.js";

const PAGE = 120;

function GameCard({ game, onPlay, index }) {
  const [loaded, setLoaded] = useState(false);
  const fav = isFavorite(game);
  return (
    <div class="game-card" style={{ "--i": Math.min(index, 24) }}>
      <button class="game-cover" onClick={() => onPlay(game)} aria-label={`Play ${game.name}`}>
        {game.coverUrl ? (
          <img src={game.coverUrl} alt="" loading="lazy" decoding="async" class={loaded ? "in" : ""} onLoad={() => setLoaded(true)} onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : null}
        <span class="game-fallback">{game.name.slice(0, 1)}</span>
        <span class="game-play">
          <Icon name="play" size={22} fill />
        </span>
      </button>
      <div class="game-meta">
        <span class="game-name" title={game.name}>
          {game.name}
        </span>
        <button
          class={`game-fav ${fav ? "on" : ""}`}
          aria-label={fav ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={fav}
          onClick={() => toggleFavorite(game)}
        >
          <Icon name="heart" size={16} fill={fav} />
        </button>
      </div>
    </div>
  );
}

function GamePlayer({ game, onClose }) {
  const frame = useRef(null);
  const [fav, setFav] = useState(isFavorite(game));
  const src = proxyUrl(game.gameUrl);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && !document.fullscreenElement && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const popOut = () => {
    const win = window.open("about:blank", "_blank");
    if (!win) return toast("your browser blocked the popup", { kind: "error" });
    win.document.write(
      `<!doctype html><title>${game.name.replace(/</g, "")}</title><body style="margin:0;background:#000"><iframe src="${location.origin + src}" style="position:fixed;inset:0;width:100%;height:100%;border:0" allow="fullscreen; autoplay; gamepad"></iframe></body>`,
    );
    win.document.close();
  };

  return (
    <div class="game-player" role="dialog" aria-label={game.name}>
      <div class="player-bar glass liquid">
        <button class="btn ghost sm" onClick={onClose}>
          <Icon name="back" size={16} /> Games
        </button>
        <span class="player-title">{game.name}</span>
        <div class="player-actions">
          <button class="btn ghost icon-only sm" aria-label="Favorite" data-tip={fav ? "Unfavorite" : "Favorite"} onClick={() => setFav(toggleFavorite(game))}>
            <Icon name="heart" size={17} fill={fav} />
          </button>
          <button class="btn ghost icon-only sm" aria-label="Reload" data-tip="Reload" onClick={() => (frame.current.src = src)}>
            <Icon name="refresh" size={17} />
          </button>
          <button class="btn ghost icon-only sm" aria-label="Open in a hidden tab" data-tip="about:blank tab" onClick={popOut}>
            <Icon name="external" size={17} />
          </button>
          <button class="btn ghost icon-only sm" aria-label="Fullscreen" data-tip="Fullscreen" onClick={() => frame.current?.requestFullscreen?.()}>
            <Icon name="fullscreen" size={17} />
          </button>
        </div>
      </div>
      <iframe ref={frame} class="game-frame" src={src} title={game.name} allow="fullscreen; autoplay; gamepad; clipboard-write; pointer-lock" />
    </div>
  );
}

export function Games() {
  const source = settings.value.gameSource;
  const [games, setGames] = useState([]);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [playing, setPlaying] = useState(null);
  const sentinel = useRef(null);

  const load = (force = false) => {
    setState("loading");
    loadSource(source, { force })
      .then((list) => {
        setGames(list);
        setState("ready");
      })
      .catch((err) => {
        setError(err.message);
        setState("error");
      });
  };

  useEffect(load, [source]);

  // deep link: /games?play=<key> reopens a recent or favorite game
  useEffect(() => {
    const key = new URLSearchParams(location.search).get("play");
    if (!key) return;
    const game = [...recents.value, ...favorites.value].find((entry) => entry.key === key);
    if (game) play(game);
    history.replaceState(null, "", "/games");
  }, []);

  const pool = view === "favorites" ? favorites.value : view === "recent" ? recents.value : games;
  const results = useMemo(() => searchGames(pool.map((game) => ({ ...game, _n: game._n ?? normalize(game.name), _a: game._a ?? "" })), query), [pool, query]);

  useEffect(() => setLimit(PAGE), [query, view, source]);

  // render more as you scroll instead of 4,000 cards at once
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && setLimit((value) => value + PAGE), { rootMargin: "800px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [results.length, limit]);

  function play(game) {
    addRecent(game);
    if (game.isExternal) {
      openInBrowser(game.gameUrl);
      return;
    }
    setPlaying(game);
  }

  if (playing) return <GamePlayer game={playing} onClose={() => setPlaying(null)} />;

  return (
    <main class="page games-page">
      <div class="page-head">
        <div>
          <h1>Games</h1>
          <p>{state === "ready" ? `${games.length.toLocaleString()} games from ${SOURCES.find((entry) => entry.id === source)?.name || source}` : "Thousands of games, no downloads."}</p>
        </div>
        <label class="searchbox glass">
          <Icon name="search" />
          <input placeholder="Search games" value={query} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search games" />
        </label>
      </div>

      <div class="games-filters">
        <div class="chips scroll" role="tablist" aria-label="View">
          {[
            ["all", "All games", "grid"],
            ["favorites", `Favorites${favorites.value.length ? ` (${favorites.value.length})` : ""}`, "heart"],
            ["recent", "Recently played", "clock"],
          ].map(([id, label, icon]) => (
            <button key={id} class="chip" aria-pressed={view === id} onClick={() => setView(id)}>
              <Icon name={icon} size={14} /> {label}
            </button>
          ))}
        </div>
        <div class="chips scroll" aria-label="Source">
          {SOURCES.map((entry) => (
            <button key={entry.id} class="chip" aria-pressed={source === entry.id} onClick={() => setSetting("gameSource", entry.id)}>
              {entry.name}
            </button>
          ))}
        </div>
      </div>

      {state === "loading" && view === "all" ? (
        <div class="card-grid">
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} class="game-card">
              <div class="game-cover skeleton" />
              <div class="skeleton skeleton-line" />
            </div>
          ))}
        </div>
      ) : state === "error" && view === "all" ? (
        <div class="empty">
          <Icon name="games" />
          <h3>Games didn't load</h3>
          <p>{error}</p>
          <button class="btn" onClick={() => load(true)}>
            Try again
          </button>
        </div>
      ) : results.length === 0 ? (
        <div class="empty">
          <Icon name={view === "favorites" ? "heart" : "search"} />
          <p>{query ? `Nothing matches "${query}". Try another source or a shorter search.` : view === "favorites" ? "Tap the heart on any game to keep it here." : "Games you play show up here."}</p>
        </div>
      ) : (
        <>
          <div class="card-grid">
            {results.slice(0, limit).map((game, index) => (
              <GameCard key={game.key} game={game} index={index} onPlay={play} />
            ))}
          </div>
          {limit < results.length && <div ref={sentinel} class="sentinel" />}
        </>
      )}
    </main>
  );
}
