import { useEffect, useMemo, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { NativeAd } from "../components/Ads.jsx";
import { Modal } from "../components/Modal.jsx";
import { get, post } from "../lib/api.js";
import { toast } from "../lib/notify.js";
import "../styles/media.css";

export function Cloud() {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    get("/api/cloud/games").then(setData).catch((error) => toast(error.message, { kind: "error" }));
  }, []);

  const games = data?.games || [];
  const tags = useMemo(() => [...new Set(games.flatMap((game) => game.tags))].slice(0, 14), [games]);
  const shown = games.filter((game) => (!tag || game.tags.includes(tag)) && game.name.toLowerCase().includes(query.toLowerCase()));

  const start = async () => {
    try {
      await post("/api/cloud/start", { key: picked.key });
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  };

  return (
    <main class="page cloud-page">
      <div class="page-head">
        <div>
          <h1>Cloud gaming</h1>
          <p>Full PC games streamed to your browser.</p>
        </div>
        <label class="searchbox glass">
          <Icon name="search" />
          <input placeholder="Search cloud games" value={query} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search cloud games" />
        </label>
      </div>
      <NativeAd class="page-ad" />
      <div class="cloud-offline glass">
        <span class="offline-dot" />
        <div>
          <strong>Cloud servers are offline</strong>
          <p class="muted small">You can browse the catalog, but games won't start until we have servers to run them on.</p>
        </div>
      </div>
      <div class="chips scroll">
        <button class="chip" aria-pressed={!tag} onClick={() => setTag("")}>
          All
        </button>
        {tags.map((entry) => (
          <button key={entry} class="chip" aria-pressed={tag === entry} onClick={() => setTag(entry)}>
            {entry}
          </button>
        ))}
      </div>
      <div class="card-grid cloud-grid">
        {!data
          ? Array.from({ length: 12 }, (_, i) => <span key={i} class="cloud-card skeleton" />)
          : shown.map((game) => (
              <button key={game.key} class="cloud-card" onClick={() => setPicked(game)}>
                <img src={game.cover || game.image} alt="" loading="lazy" />
                <span class="cloud-name">{game.name}</span>
              </button>
            ))}
      </div>
      {picked && (
        <Modal title={picked.name} onClose={() => setPicked(null)}>
          <div class="cloud-detail">
            <img src={picked.image || picked.cover} alt="" />
            <div class="chips">
              {picked.tags.map((entry) => (
                <span key={entry} class="badge">
                  {entry}
                </span>
              ))}
            </div>
            <p class="muted">{picked.description}</p>
            <button class="btn primary" onClick={start}>
              <Icon name="play" size={16} fill /> Play in the cloud
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
