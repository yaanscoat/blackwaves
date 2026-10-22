import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { get } from "../lib/api.js";
import { navigate, route, segments } from "../lib/router.js";
import { storage } from "../lib/storage.js";
import { createFrame } from "../lib/proxy.js";
import "../styles/media.css";

const img = (path, size = "w342") => (path ? `/api/movies/img/${size}${path}` : "");

// the four embed players, in the order we try them. tmdb ids all the way down.
const PLAYERS = [
  { id: "videasy", name: "videasy", movie: (id) => `https://player.videasy.to/movie/${id}`, tv: (id, s, e) => `https://player.videasy.to/tv/${id}/${s}/${e}` },
  { id: "vidsrc", name: "vidsrc", movie: (id) => `https://vidsrc.cc/v2/embed/movie/${id}`, tv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}` },
  { id: "2embed", name: "2embed", movie: (id) => `https://www.2embed.skin/embed/${id}`, tv: (id, s, e) => `https://www.2embed.skin/embedtv/${id}&s=${s}&e=${e}` },
  { id: "vidlink", name: "vidlink", movie: (id) => `https://vidlink.pro/movie/${id}`, tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}` },
];

function useFetch(url, deps = [url]) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  useEffect(() => {
    if (!url) return setState({ data: null, error: null, loading: false });
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    get(url, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => error.name !== "AbortError" && setState({ data: null, error, loading: false }));
    return () => controller.abort();
  }, deps);
  return state;
}

function title(item) {
  return item.title || item.name || "Untitled";
}

function year(item) {
  return String(item.release_date || item.first_air_date || "").slice(0, 4);
}

function PosterCard({ item, type, onOpen }) {
  const kind = item.media_type || type;
  if (kind !== "movie" && kind !== "tv") return null;
  return (
    <button class="poster-card" onClick={() => onOpen(kind, item.id)} aria-label={title(item)}>
      <span class="poster">
        {item.poster_path ? <img src={img(item.poster_path)} alt="" loading="lazy" /> : <span class="poster-fallback">{title(item)}</span>}
        {item.vote_average > 0 && <span class="poster-rating">★ {item.vote_average.toFixed(1)}</span>}
      </span>
      <span class="poster-title">{title(item)}</span>
      <span class="faint small">
        {year(item)} · {kind === "tv" ? "Show" : "Movie"}
      </span>
    </button>
  );
}

function Row({ heading, url, type, onOpen }) {
  const { data, loading } = useFetch(url);
  const scroller = useRef(null);
  const items = data?.results || [];
  if (!loading && !items.length) return null;
  return (
    <section class="media-row">
      <div class="section-title">
        <h2>{heading}</h2>
        <div class="row-arrows">
          <button class="btn ghost icon-only sm" aria-label="Scroll left" onClick={() => scroller.current.scrollBy({ left: -600, behavior: "smooth" })}>
            <Icon name="back" size={16} />
          </button>
          <button class="btn ghost icon-only sm" aria-label="Scroll right" onClick={() => scroller.current.scrollBy({ left: 600, behavior: "smooth" })}>
            <Icon name="forward" size={16} />
          </button>
        </div>
      </div>
      <div class="poster-row" ref={scroller}>
        {loading
          ? Array.from({ length: 8 }, (_, i) => <span key={i} class="poster skeleton" />)
          : items.map((item) => <PosterCard key={item.id} item={item} type={type} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function Browse({ onOpen }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState("movie");
  const [genre, setGenre] = useState(null);
  const genres = useFetch(`/api/movies/genres/${type}`);
  const status = useFetch("/api/movies/status");
  const hero = useFetch("/api/movies/trending/all/day");
  const search = useFetch(debounced ? `/api/movies/search/multi?query=${encodeURIComponent(debounced)}` : null);
  const discover = useFetch(genre ? `/api/movies/discover/${type}?genre=${genre}` : null, [genre, type]);
  const continueWatching = storage.get("watchProgress", []);
  const watchlist = storage.get("watchlist", []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  if (status.data && !status.data.tmdb) {
    return (
      <div class="empty">
        <Icon name="movies" />
        <h3>Movies are switched off on this server</h3>
        <p>Whoever runs this blackwaves needs to set a TMDB_API_KEY. It's free at themoviedb.org.</p>
      </div>
    );
  }

  const featured = hero.data?.results?.find((item) => item.backdrop_path);

  return (
    <>
      {featured && !debounced && !genre && (
        <section class="media-hero" style={{ "--backdrop": `url(${img(featured.backdrop_path, "w1280")})` }}>
          <div class="media-hero-text">
            <span class="badge">Trending today</span>
            <h1>{title(featured)}</h1>
            <p class="muted clamp-3">{featured.overview}</p>
            <div class="btn-row">
              <button class="btn primary" onClick={() => onOpen(featured.media_type, featured.id, true)}>
                <Icon name="play" size={16} fill /> Play
              </button>
              <button class="btn" onClick={() => onOpen(featured.media_type, featured.id)}>
                More info
              </button>
            </div>
          </div>
        </section>
      )}

      <div class="media-toolbar">
        <label class="searchbox glass">
          <Icon name="search" />
          <input placeholder="Search movies and shows" value={query} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search movies and shows" />
        </label>
        <div class="segmented" role="radiogroup" aria-label="Type">
          {[
            ["movie", "Movies"],
            ["tv", "Shows"],
          ].map(([id, label]) => (
            <button key={id} role="radio" aria-checked={type === id} onClick={() => (setType(id), setGenre(null))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div class="chips scroll genre-chips">
        <button class="chip" aria-pressed={!genre} onClick={() => setGenre(null)}>
          All genres
        </button>
        {(genres.data?.genres || []).map((entry) => (
          <button key={entry.id} class="chip" aria-pressed={genre === entry.id} onClick={() => setGenre(entry.id)}>
            {entry.name}
          </button>
        ))}
      </div>

      {debounced ? (
        <section>
          <div class="section-title">
            <h2>Results for "{debounced}"</h2>
          </div>
          {search.loading ? (
            <div class="empty">
              <div class="spinner" />
            </div>
          ) : (search.data?.results || []).filter((item) => item.media_type !== "person").length ? (
            <div class="card-grid poster-grid">
              {search.data.results.map((item) => (
                <PosterCard key={`${item.media_type}-${item.id}`} item={item} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div class="empty">
              <Icon name="search" />
              <p>Nothing found. Check the spelling or try the original title.</p>
            </div>
          )}
        </section>
      ) : genre ? (
        <div class="card-grid poster-grid">
          {(discover.data?.results || []).map((item) => (
            <PosterCard key={item.id} item={item} type={type} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <>
          {continueWatching.length > 0 && (
            <section class="media-row">
              <div class="section-title">
                <h2>Continue watching</h2>
              </div>
              <div class="poster-row">
                {continueWatching.map((entry) => (
                  <button key={`${entry.type}-${entry.id}`} class="poster-card" onClick={() => onOpen(entry.type, entry.id, true)}>
                    <span class="poster">
                      {entry.poster ? <img src={img(entry.poster)} alt="" loading="lazy" /> : <span class="poster-fallback">{entry.title}</span>}
                      <span class="poster-play">
                        <Icon name="play" size={22} fill />
                      </span>
                    </span>
                    <span class="poster-title">{entry.title}</span>
                    <span class="faint small">{entry.type === "tv" ? `S${entry.season} · E${entry.episode}` : "Movie"}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {watchlist.length > 0 && (
            <section class="media-row">
              <div class="section-title">
                <h2>Your list</h2>
              </div>
              <div class="poster-row">
                {watchlist.map((entry) => (
                  <PosterCard key={`${entry.media_type}-${entry.id}`} item={entry} onOpen={onOpen} />
                ))}
              </div>
            </section>
          )}
          <Row heading="Trending this week" url={`/api/movies/trending/${type}/week`} type={type} onOpen={onOpen} />
          <Row heading={type === "tv" ? "Popular shows" : "Popular movies"} url={`/api/movies/popular/${type}`} type={type} onOpen={onOpen} />
          <Row heading="Top rated" url={`/api/movies/top/${type}`} type={type} onOpen={onOpen} />
        </>
      )}
    </>
  );
}

function HlsPlayer({ src, onFail }) {
  const video = useRef(null);
  useEffect(() => {
    let hls;
    let cancelled = false;
    (async () => {
      const el = video.current;
      if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = src;
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) return onFail();
      hls = new Hls({ maxBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(el);
      hls.on(Hls.Events.ERROR, (_, data) => data.fatal && onFail());
    })();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);
  return <video ref={video} class="player-frame" controls autoplay playsInline />;
}

/** the embed players run inside scramjet, so they're proxied like everything else */
function ProxiedEmbed({ url }) {
  const iframe = useRef(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setError("");
    // most embed players refuse to run unless they're inside an iframe, and
    // inside scramjet they'd be the top page. so scramjet loads a tiny wrapper
    // page and the player lives in an iframe inside it, still fully proxied.
    const wrapper = `data:text/html;charset=utf-8,${encodeURIComponent(
      `<!doctype html><meta name="referrer" content="origin"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="${url.replace(/"/g, "&quot;")}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="origin"></iframe>`,
    )}`;
    createFrame(iframe.current)
      .then((frame) => !cancelled && frame.go(wrapper))
      .catch((err) => !cancelled && setError(err.message || "the proxy didn't start"));
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) {
    return (
      <div class="empty">
        <p>{error}</p>
      </div>
    );
  }
  // sandboxed without allow-top-navigation or allow-popups: some players try to
  // yank the whole tab away (one sent you back to the home page) or spawn ad popups
  return (
    <iframe
      ref={iframe}
      class="player-frame"
      sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      title="Player"
    />
  );
}

function Player({ type, id, season, episode }) {
  const [player, setPlayer] = useState(() => storage.get("moviePlayer", "auto"));
  const streams = useFetch(type === "movie" ? `/api/movies/stream/movie/${id}` : `/api/movies/stream/tv/${id}/${season}/${episode}`);
  const [hlsFailed, setHlsFailed] = useState(false);
  const hls = streams.data?.streams?.find((stream) => stream.type === "hls");

  useEffect(() => setHlsFailed(false), [id, season, episode]);

  const native = player === "auto" || player === "blackwaves";
  const builtIn = native && hls && !hlsFailed;
  const waiting = native && streams.loading;
  // no direct stream found? fall back to the first embed instead of a sad black box
  const embed = PLAYERS.find((entry) => entry.id === (native ? "videasy" : player));
  const choose = (value) => {
    setPlayer(value);
    storage.set("moviePlayer", value);
  };

  return (
    <div class="player-wrap">
      <div class="player-stage">
        {builtIn ? (
          <HlsPlayer src={hls.url} onFail={() => setHlsFailed(true)} />
        ) : waiting ? (
          <div class="empty">
            <div class="spinner" />
            <p>Finding the best stream...</p>
          </div>
        ) : embed ? (
          <ProxiedEmbed key={embed.id + season + episode} url={type === "movie" ? embed.movie(id) : embed.tv(id, season, episode)} />
        ) : null}
      </div>
      <div class="player-sources">
        <span class="muted small">Player</span>
        <div class="chips scroll">
          <button class="chip" aria-pressed={player === "auto" || player === "blackwaves"} onClick={() => choose("blackwaves")} disabled={!streams.loading && !hls}>
            <Icon name="wave" size={14} /> blackwaves {streams.loading ? "(searching)" : hls ? "" : "(none found)"}
          </button>
          {PLAYERS.map((entry) => (
            <button key={entry.id} class="chip" aria-pressed={player === entry.id} onClick={() => choose(entry.id)}>
              {entry.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Detail({ type, id, autoplay }) {
  const { data, error, loading } = useFetch(`/api/movies/${type}/${id}`);
  const progress = storage.get("watchProgress", []).find((entry) => entry.type === type && String(entry.id) === String(id));
  const [playing, setPlaying] = useState(autoplay);
  const [season, setSeason] = useState(progress?.season || 1);
  const [episode, setEpisode] = useState(progress?.episode || 1);
  const seasonData = useFetch(type === "tv" ? `/api/movies/tv/${id}/season/${season}` : null);
  const [inList, setInList] = useState(() => storage.get("watchlist", []).some((entry) => String(entry.id) === String(id)));

  useEffect(() => {
    if (!data || !playing) return;
    // remember where you were so the home page and "continue watching" can bring you back
    const entry = { type, id: data.id, title: title(data), poster: data.poster_path, season, episode, at: Date.now() };
    const list = storage.get("watchProgress", []).filter((item) => !(item.type === type && item.id === data.id));
    storage.set("watchProgress", [entry, ...list].slice(0, 20));
  }, [data, playing, season, episode]);

  if (loading) {
    return (
      <div class="empty">
        <div class="spinner" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div class="empty">
        <Icon name="movies" />
        <p>{error?.message || "That title couldn't be loaded."}</p>
        <button class="btn" onClick={() => navigate("/movies")}>
          Back to movies
        </button>
      </div>
    );
  }

  const seasons = (data.seasons || []).filter((entry) => entry.season_number > 0);
  const toggleList = () => {
    const list = storage.get("watchlist", []);
    const next = inList ? list.filter((entry) => String(entry.id) !== String(id)) : [{ id: data.id, media_type: type, title: title(data), poster_path: data.poster_path, vote_average: data.vote_average, release_date: data.release_date, first_air_date: data.first_air_date }, ...list];
    storage.set("watchlist", next);
    setInList(!inList);
  };

  return (
    <article class="detail">
      <div class="detail-backdrop" style={{ "--backdrop": data.backdrop_path ? `url(${img(data.backdrop_path, "w1280")})` : "none" }} />
      <button class="btn ghost sm detail-back" onClick={() => navigate("/movies")}>
        <Icon name="back" size={16} /> Movies & shows
      </button>
      {playing && <Player type={type} id={id} season={season} episode={episode} />}
      <div class="detail-main">
        <img class="detail-poster" src={img(data.poster_path, "w500")} alt="" />
        <div class="detail-text">
          <h1>{title(data)}</h1>
          <p class="muted">
            {[year(data), type === "tv" ? `${data.number_of_seasons} season${data.number_of_seasons === 1 ? "" : "s"}` : data.runtime ? `${data.runtime} min` : "", data.vote_average ? `★ ${data.vote_average.toFixed(1)}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div class="chips">
            {(data.genres || []).map((entry) => (
              <span key={entry.id} class="badge">
                {entry.name}
              </span>
            ))}
          </div>
          <p class="detail-overview">{data.overview}</p>
          <div class="btn-row">
            <button class="btn primary" onClick={() => (setPlaying(true), window.scrollTo({ top: 0, behavior: "smooth" }))}>
              <Icon name="play" size={16} fill /> {type === "tv" ? `Play S${season} E${episode}` : progress ? "Resume" : "Play"}
            </button>
            <button class="btn" onClick={toggleList}>
              <Icon name={inList ? "check" : "plus"} size={16} /> {inList ? "In your list" : "Add to list"}
            </button>
          </div>
          {data.credits?.cast?.length > 0 && (
            <p class="faint small">Starring {data.credits.cast.slice(0, 5).map((person) => person.name).join(", ")}</p>
          )}
        </div>
      </div>

      {type === "tv" && seasons.length > 0 && (
        <section class="episodes">
          <div class="section-title">
            <h2>Episodes</h2>
            <select class="select season-select" value={season} onChange={(event) => (setSeason(Number(event.currentTarget.value)), setEpisode(1))} aria-label="Season">
              {seasons.map((entry) => (
                <option key={entry.season_number} value={entry.season_number}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <div class="episode-list">
            {(seasonData.data?.episodes || []).map((entry) => (
              <button
                key={entry.id}
                class={`episode ${entry.episode_number === episode && playing ? "current" : ""}`}
                onClick={() => {
                  setEpisode(entry.episode_number);
                  setPlaying(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                <span class="episode-still">
                  {entry.still_path ? <img src={img(entry.still_path, "w300")} alt="" loading="lazy" /> : null}
                  <span class="episode-num">{entry.episode_number}</span>
                </span>
                <span class="episode-text">
                  <strong>{entry.name}</strong>
                  <span class="muted small clamp-2">{entry.overview}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {data.recommendations?.results?.length > 0 && (
        <section class="media-row">
          <div class="section-title">
            <h2>More like this</h2>
          </div>
          <div class="poster-row">
            {data.recommendations.results.slice(0, 18).map((item) => (
              <PosterCard key={item.id} item={item} type={type} onOpen={(kind, nextId) => navigate(`/movies/${kind}/${nextId}`)} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

export function Movies() {
  const parts = segments(route.value);
  const [, type, id] = parts;
  const autoplay = new URLSearchParams(location.search).has("play");
  const open = (kind, nextId, play = false) => navigate(`/movies/${kind}/${nextId}${play ? "?play" : ""}`);
  return (
    <main class="page movies-page">
      {(type === "movie" || type === "tv") && id ? (
        <Detail key={`${type}-${id}`} type={type} id={id} autoplay={autoplay} />
      ) : (
        <>
          <div class="page-head">
            <div>
              <h1>Movies & shows</h1>
              <p>Search anything, pick a player, press play.</p>
            </div>
          </div>
          <Browse onOpen={open} />
        </>
      )}
    </main>
  );
}
