import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { NativeAd } from "../components/Ads.jsx";
import { get } from "../lib/api.js";
import { storage } from "../lib/storage.js";
import { navigate, route, segments } from "../lib/router.js";
import "../styles/media.css";

const SOURCES = [
  { id: "mangadex", name: "MangaDex" },
  { id: "pill", name: "MangaPill" },
];

// mangapill ids look like "123/some-slug", mangadex ids are uuids
const enc = (id) => id.split("/").map(encodeURIComponent).join("/");
const detailPath = (source, id) => (source === "pill" ? `/api/manga/pill/title/${enc(id)}` : `/api/manga/mangadex/${enc(id)}`);
const chaptersPath = (source, id) => `${detailPath(source, id)}/chapters`;
const pagesPath = (source, chapter) => (source === "pill" ? `/api/manga/pill/chapter/${enc(chapter)}/pages` : `/api/manga/mangadex/chapter/${enc(chapter)}/pages`);

function Reader({ source, chapters, index, onClose, onChange }) {
  const chapter = chapters[index];
  const [pages, setPages] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setPages(null);
    setError("");
    window.scrollTo({ top: 0 });
    get(pagesPath(source, chapter.id))
      .then((data) => setPages(data.pages))
      .catch((err) => setError(err.message));
  }, [chapter.id]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "ArrowRight" && index < chapters.length - 1) onChange(index + 1);
      if (event.key === "ArrowLeft" && index > 0) onChange(index - 1);
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  const nav = (
    <div class="reader-nav glass">
      <button class="btn ghost sm" onClick={onClose}>
        <Icon name="back" size={16} /> Chapters
      </button>
      <span class="reader-title">Chapter {chapter.chapter || "?"}{chapter.title ? ` · ${chapter.title}` : ""}</span>
      <button class="btn ghost icon-only sm" aria-label="Previous chapter" disabled={index === 0} onClick={() => onChange(index - 1)}>
        <Icon name="back" size={16} />
      </button>
      <button class="btn ghost icon-only sm" aria-label="Next chapter" disabled={index >= chapters.length - 1} onClick={() => onChange(index + 1)}>
        <Icon name="forward" size={16} />
      </button>
    </div>
  );

  return (
    <div class="reader">
      {nav}
      {error ? (
        <div class="empty">
          <p>{error}</p>
        </div>
      ) : !pages ? (
        <div class="empty">
          <div class="spinner" />
        </div>
      ) : (
        <div class="reader-pages">
          {pages.map((page, i) => (
            <img key={page} src={page} alt={`Page ${i + 1}`} loading={i < 3 ? "eager" : "lazy"} />
          ))}
          {index < chapters.length - 1 && (
            <button class="btn primary reader-next" onClick={() => onChange(index + 1)}>
              Next chapter <Icon name="forward" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ source, id }) {
  const [detail, setDetail] = useState(null);
  const [chapters, setChapters] = useState(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(-1);
  const progress = storage.get("mangaProgress", {})[`${source}:${id}`];

  useEffect(() => {
    get(detailPath(source, id)).then(setDetail).catch((err) => setError(err.message));
    get(chaptersPath(source, id))
      .then((data) => setChapters(data.chapters))
      .catch(() => setChapters([]));
  }, [source, id]);

  const read = (index) => {
    setReading(index);
    const chapter = chapters[index];
    const all = storage.get("mangaProgress", {});
    all[`${source}:${id}`] = { chapterId: chapter.id, chapter: chapter.chapter, title: detail?.title, cover: detail?.cover, source, id, at: Date.now() };
    storage.set("mangaProgress", { ...all });
  };

  if (reading >= 0 && chapters) return <Reader source={source} chapters={chapters} index={reading} onClose={() => setReading(-1)} onChange={read} />;
  if (error) {
    return (
      <div class="empty">
        <Icon name="manga" />
        <p>{error}</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div class="empty">
        <div class="spinner" />
      </div>
    );
  }
  const resumeIndex = progress && chapters ? chapters.findIndex((chapter) => chapter.id === progress.chapterId) : -1;
  return (
    <article class="manga-detail">
      <button class="btn ghost sm" onClick={() => navigate("/manga")}>
        <Icon name="back" size={16} /> Manga
      </button>
      <div class="detail-main">
        {detail.cover && <img class="detail-poster" src={detail.cover} alt="" />}
        <div class="detail-text">
          <h1>{detail.title}</h1>
          <p class="muted">{[detail.authors?.join(", "), detail.status, detail.year].filter(Boolean).join(" · ")}</p>
          <div class="chips">
            {(detail.tags || []).map((tag) => (
              <span key={tag} class="badge">
                {tag}
              </span>
            ))}
          </div>
          {detail.description && <p class="detail-overview">{detail.description}</p>}
          <div class="btn-row">
            <button class="btn primary" disabled={!chapters?.length} onClick={() => read(resumeIndex >= 0 ? resumeIndex : 0)}>
              <Icon name="manga" size={16} /> {resumeIndex >= 0 ? `Continue chapter ${chapters[resumeIndex].chapter}` : "Start reading"}
            </button>
          </div>
        </div>
      </div>
      <div class="section-title">
        <h2>Chapters</h2>
        <span class="muted small">{chapters ? `${chapters.length} chapters` : ""}</span>
      </div>
      {!chapters ? (
        <div class="spinner" />
      ) : chapters.length === 0 ? (
        <p class="muted">No English chapters available here. Try the other source.</p>
      ) : (
        <div class="chapter-grid">
          {chapters.map((chapter, index) => (
            <button key={chapter.id} class={`chapter ${index === resumeIndex ? "current" : ""}`} onClick={() => read(index)}>
              <span>Ch. {chapter.chapter || "?"}</span>
              {chapter.title && <span class="faint small">{chapter.title}</span>}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function Browse() {
  const [source, setSource] = useState(() => storage.get("mangaSource", "mangadex"));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const reading = Object.values(storage.get("mangaProgress", {})).sort((a, b) => b.at - a.at);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setData(null);
    setError("");
    const url = source === "pill" ? `/api/manga/pill/search?title=${encodeURIComponent(debounced)}` : debounced ? `/api/manga/mangadex/search?title=${encodeURIComponent(debounced)}` : "/api/manga/mangadex/latest";
    get(url).then(setData).catch((err) => setError(err.message));
  }, [source, debounced]);

  const open = (id) => navigate(`/manga/${source}/${id}`);

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Manga</h1>
          <p>English chapters from MangaDex and MangaPill, safe-for-school filter on.</p>
        </div>
        <label class="searchbox glass">
          <Icon name="search" />
          <input placeholder="Search manga" value={query} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search manga" />
        </label>
      </div>
      <div class="chips scroll">
        {SOURCES.map((entry) => (
          <button key={entry.id} class="chip" aria-pressed={source === entry.id} onClick={() => (setSource(entry.id), storage.set("mangaSource", entry.id))}>
            {entry.name}
          </button>
        ))}
      </div>
      <NativeAd class="page-ad" />
      {reading.length > 0 && !debounced && (
        <section class="media-row">
          <div class="section-title">
            <h2>Keep reading</h2>
          </div>
          <div class="poster-row">
            {reading.slice(0, 12).map((entry) => (
              <button key={`${entry.source}-${entry.id}`} class="poster-card" onClick={() => navigate(`/manga/${entry.source}/${entry.id}`)}>
                <span class="poster">{entry.cover ? <img src={entry.cover} alt="" loading="lazy" /> : <span class="poster-fallback">{entry.title}</span>}</span>
                <span class="poster-title">{entry.title}</span>
                <span class="faint small">Chapter {entry.chapter}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div class="section-title">
        <h2>{debounced ? `Results for "${debounced}"` : "Recently updated"}</h2>
      </div>
      {error ? (
        <div class="empty">
          <Icon name="manga" />
          <p>{error}</p>
        </div>
      ) : !data ? (
        <div class="card-grid poster-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} class="poster skeleton" />
          ))}
        </div>
      ) : !data.items?.length ? (
        <div class="empty">
          <p>Nothing found. Try the other source.</p>
        </div>
      ) : (
        <div class="card-grid poster-grid">
          {data.items.map((item) => (
            <button key={item.id} class="poster-card" onClick={() => open(item.id)}>
              <span class="poster">{item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span class="poster-fallback">{item.title}</span>}</span>
              <span class="poster-title">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function Manga() {
  const [, source, ...rest] = segments(route.value);
  return <main class="page manga-page">{source && rest.length ? <Detail key={rest.join("/")} source={source} id={rest.join("/")} /> : <Browse />}</main>;
}
