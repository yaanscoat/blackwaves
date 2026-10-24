// music, laid out like spotify's home: library on the left, shelves in the
// middle, the now-playing bar along the bottom. the audio itself lives in
// lib/player.js so it keeps going when you leave this page.
import { useEffect, useMemo, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { Icon } from "../components/Icon.jsx";
import { get } from "../lib/api.js";
import { storage } from "../lib/storage.js";
import {
  nowPlaying,
  playing,
  progress,
  loadingTrack,
  volume,
  shuffle,
  repeat,
  likes,
  savedAlbums,
  playTrack,
  toggle,
  next,
  prev,
  seek,
  setVolume,
  toggleLike,
  toggleShuffle,
  cycleRepeat,
  downloadTrack,
  toggleSavedAlbum,
  isSavedAlbum,
  followedArtists,
  isFollowing,
  toggleFollow,
  formatTime,
} from "../lib/player.js";
import { me } from "../lib/account.js";
import "../styles/media.css";
import "../styles/music.css";

const hideBroken = (event) => (event.currentTarget.style.visibility = "hidden");

// browse tiles: each one is a youtube music search dressed up as a playlist
const BROWSE = [
  ["Pop hits", "pop hits"],
  ["Hip-hop", "hip hop hits"],
  ["Lo-fi to study to", "lofi beats"],
  ["Electronic", "electronic dance hits"],
  ["R&B", "r&b hits"],
  ["Rock classics", "classic rock"],
  ["Chill", "chill vibes"],
  ["Workout", "workout music"],
  ["Gaming", "gaming music"],
  ["Anime", "anime openings"],
  ["Throwbacks", "2000s hits"],
  ["Phonk", "phonk"],
].map(([title, query], index) => ({ id: `browse-${index}`, title, url: `/api/music/search?type=tracks&q=${encodeURIComponent(query)}` }));

const SOURCE_LABEL = { ytmusic: "YouTube Music", soundcloud: "SoundCloud" };

// the open album/artist/playlist lives out here so any artist name anywhere on
// the page can open a profile, and so leaving music and coming back keeps your place.
// back walks the stack like a browser would. a tiny, ad-free browser.
const view = signal(null);
const backStack = [];

function openView(next) {
  if (view.value) backStack.push(view.value);
  if (backStack.length > 40) backStack.shift();
  view.value = next;
  document.querySelector(".sp-scroll")?.scrollTo({ top: 0 });
}

function goBack() {
  view.value = backStack.pop() || null;
}

function closeViews() {
  backStack.length = 0;
  view.value = null;
}

function ArtistLink({ artist, class: className = "" }) {
  if (!artist?.name) return null;
  if (!artist.id) return <span class={className}>{artist.name}</span>;
  const go = (event) => {
    event.stopPropagation();
    openView({ kind: "artist", id: artist.id });
  };
  return (
    <span class={`artist-link ${className}`} role="link" tabIndex={0} onClick={go} onKeyDown={(event) => event.key === "Enter" && go(event)}>
      {artist.name}
    </span>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? "Up late?" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function useData(url) {
  const [state, setState] = useState({ data: null, error: "", loading: Boolean(url) });
  useEffect(() => {
    if (!url) return setState({ data: null, error: "", loading: false });
    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    get(url)
      .then((data) => alive && setState({ data, error: "", loading: false }))
      .catch((error) => alive && setState({ data: null, error: error.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

function PlayFab({ onClick, label = "Play", active = false }) {
  return (
    <button
      class={`play-fab ${active ? "active" : ""}`}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon name={active && playing.value ? "pause" : "play"} size={20} fill />
    </button>
  );
}

function TrackCard({ track, list }) {
  const active = nowPlaying.value?.id === track.id;
  return (
    <div class="m-card" onClick={() => (active ? toggle() : playTrack(track, list))} role="button" tabIndex={0}>
      <span class="m-art">
        {track.album?.cover ? <img src={track.album.cover} alt="" loading="lazy" onError={hideBroken} /> : <Icon name="music" />}
        <PlayFab active={active} onClick={() => (active ? toggle() : playTrack(track, list))} />
      </span>
      <span class="m-title">{track.title}</span>
      <ArtistLink class="m-sub" artist={track.artist} />
    </div>
  );
}

function AlbumCard({ album, onOpen, sub }) {
  return (
    <div class="m-card" onClick={() => onOpen({ kind: "album", id: album.id })} role="button" tabIndex={0}>
      <span class="m-art">
        {album.cover ? <img src={album.cover} alt="" loading="lazy" onError={hideBroken} /> : <Icon name="music" />}
        <PlayFab label={`Open ${album.title}`} onClick={() => onOpen({ kind: "album", id: album.id, autoplay: true })} />
      </span>
      <span class="m-title">{album.title}</span>
      {sub ? <span class="m-sub">{sub}</span> : album.artist?.name ? <ArtistLink class="m-sub" artist={album.artist} /> : <span class="m-sub">{album.count} songs</span>}
    </div>
  );
}

function ArtistCard({ artist, onOpen }) {
  return (
    <div class="m-card artist" onClick={() => onOpen({ kind: "artist", id: artist.id })} role="button" tabIndex={0}>
      <span class="m-art round">{artist.picture ? <img src={artist.picture} alt="" loading="lazy" onError={hideBroken} /> : <Icon name="user" />}</span>
      <span class="m-title">{artist.name}</span>
      <span class="m-sub">Artist</span>
    </div>
  );
}

function HomeShelves({ onOpen }) {
  const { data, loading, error } = useData("/api/music/home");
  if (loading) return <Shelf title="Loading your music..." loading onOpen={onOpen} />;
  if (error) {
    return (
      <div class="empty">
        <Icon name="music" />
        <p>{error}</p>
      </div>
    );
  }
  return (data?.shelves || []).map((shelf) => <Shelf key={shelf.title} title={shelf.title} items={shelf.items} kind={shelf.kind} source={shelf.source} onOpen={onOpen} />);
}

function Shelf({ title, url, items: given, onOpen, kind = "tracks", source, loading: forced = false }) {
  const { data, loading: fetching } = useData(given ? null : url);
  const loading = forced || (!given && fetching);
  const items = (given || data?.items || []).slice(0, 14);
  if (!loading && !items.length) return null;
  return (
    <section class="shelf">
      <h2>
        {title}
        {source && <span class="source-tag">{SOURCE_LABEL[source]}</span>}
      </h2>
      <div class="shelf-row">
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} class="m-card">
                <span class="m-art skeleton" />
              </div>
            ))
          : items.map((item) =>
              kind === "albums" ? <AlbumCard key={item.id} album={item} onOpen={onOpen} /> : <TrackCard key={item.id} track={item} list={items} />,
            )}
      </div>
    </section>
  );
}

function TrackTable({ tracks, showAlbum = true, showPlays = false }) {
  const current = nowPlaying.value;
  if (!tracks.length) return null;
  return (
    <div class="t-table" role="table">
      <div class="t-row t-head" role="row">
        <span>#</span>
        <span>Title</span>
        {showPlays ? <span class="t-album">Plays</span> : showAlbum && <span class="t-album">Album</span>}
        <span class="t-dur">
          <Icon name="clock" size={15} />
        </span>
      </div>
      {tracks.map((track, index) => {
        const active = current?.id === track.id;
        const liked = likes.value.some((entry) => entry.id === track.id);
        return (
          <div key={track.id} class={`t-row ${active ? "active" : ""}`} role="row" onDblClick={() => playTrack(track, tracks)}>
            <span class="t-num">
              <span class="t-index">{active && playing.value ? <span class="eq mini"><i /><i /><i /></span> : index + 1}</span>
              <button class="t-play" aria-label={`Play ${track.title}`} onClick={() => (active ? toggle() : playTrack(track, tracks))}>
                <Icon name={active && playing.value ? "pause" : "play"} size={14} fill />
              </button>
            </span>
            <span class="t-main">
              <span class="t-art">{track.album?.cover ? <img src={track.album.cover} alt="" loading="lazy" onError={hideBroken} /> : <Icon name="music" size={14} />}</span>
              <span class="t-text">
                <span class="t-title">
                  {track.title}
                  {track.explicit && <span class="badge explicit">E</span>}
                </span>
                <ArtistLink class="t-sub" artist={track.artist} />
              </span>
            </span>
            {showPlays ? (
              <span class="t-album t-sub t-plays">{track.plays || ""}</span>
            ) : (
              showAlbum &&
              (track.album?.id ? (
                <span class="t-album t-sub artist-link" role="link" tabIndex={0} onClick={() => openView({ kind: "album", id: track.album.id })}>
                  {track.album.title}
                </span>
              ) : (
                <span class="t-album t-sub">{track.album?.title}</span>
              ))
            )}
            <span class="t-dur">
              <button class={`t-icon ${liked ? "on" : ""}`} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} onClick={() => toggleLike(track)}>
                <Icon name="heart" size={15} fill={liked} />
              </button>
              <span class="t-time">{formatTime(track.duration)}</span>
              <button class="t-icon" aria-label="Download" onClick={() => downloadTrack(track)}>
                <Icon name="download" size={15} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Home({ onOpen }) {
  const recent = storage.get("musicRecents", []);
  const quick = useMemo(() => {
    const tiles = [];
    if (likes.value.length) tiles.push({ type: "liked" });
    for (const album of savedAlbums.value.slice(0, 3)) tiles.push({ type: "album", album });
    for (const track of recent) if (tiles.length < 8) tiles.push({ type: "track", track });
    return tiles.slice(0, 8);
  }, [likes.value, savedAlbums.value]);

  return (
    <>
      <h1 class="m-greeting">
        {greeting()}
        {me.value ? `, ${me.value.displayName}` : ""}
      </h1>
      {quick.length > 0 && (
        <div class="quick-grid">
          {quick.map((tile, index) =>
            tile.type === "liked" ? (
              <div key="liked" class="quick" onClick={() => onOpen({ kind: "liked" })} role="button" tabIndex={0}>
                <span class="quick-art liked-art">
                  <Icon name="heart" size={22} fill />
                </span>
                <span class="quick-title">Liked Songs</span>
                <PlayFab onClick={() => likes.value[0] && playTrack(likes.value[0], likes.value)} />
              </div>
            ) : tile.type === "album" ? (
              <div key={tile.album.id} class="quick" onClick={() => onOpen({ kind: "album", id: tile.album.id })} role="button" tabIndex={0}>
                <span class="quick-art">{tile.album.cover && <img src={tile.album.cover} alt="" />}</span>
                <span class="quick-title">{tile.album.title}</span>
                <PlayFab onClick={() => onOpen({ kind: "album", id: tile.album.id, autoplay: true })} />
              </div>
            ) : (
              <div key={tile.track.id + index} class="quick" onClick={() => playTrack(tile.track, recent)} role="button" tabIndex={0}>
                <span class="quick-art">{tile.track.album?.cover && <img src={tile.track.album.cover} alt="" />}</span>
                <span class="quick-title">{tile.track.title}</span>
                <PlayFab active={nowPlaying.value?.id === tile.track.id} onClick={() => (nowPlaying.value?.id === tile.track.id ? toggle() : playTrack(tile.track, recent))} />
              </div>
            ),
          )}
        </div>
      )}
      <HomeShelves onOpen={onOpen} />
    </>
  );
}

function Search({ query, onOpen }) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const q = encodeURIComponent(debounced);
  const tracks = useData(debounced ? `/api/music/search?type=tracks&q=${q}` : null);
  const cloud = useData(debounced ? `/api/music/search?type=tracks&source=soundcloud&q=${q}` : null);
  const albums = useData(debounced ? `/api/music/search?type=albums&q=${q}` : null);
  const artists = useData(debounced ? `/api/music/search?type=artists&q=${q}` : null);
  const cloudArtists = useData(debounced ? `/api/music/search?type=artists&source=soundcloud&q=${q}` : null);

  if (!debounced) {
    return (
      <>
        <h2 class="m-section">Browse</h2>
        <div class="genre-grid">
          {BROWSE.map((shelf, index) => (
            <button key={shelf.id} class="genre-tile" style={{ "--hue": (index * 57) % 360 }} onClick={() => onOpen({ kind: "shelf", ...shelf })}>
              {shelf.title}
            </button>
          ))}
        </div>
      </>
    );
  }
  const songs = tracks.data?.items || [];
  const cloudSongs = cloud.data?.items || [];
  const top = songs[0] || cloudSongs[0];
  const anyLoading = tracks.loading || cloud.loading;
  // typed an artist's exact name? they're the top result, like spotify does it
  const name = debounced.toLowerCase();
  const topArtist = [...(artists.data?.items || []), ...(cloudArtists.data?.items || [])].find((artist) => artist.name?.toLowerCase() === name);
  return (
    <>
      {anyLoading && !top ? (
        <div class="empty">
          <div class="spinner" />
        </div>
      ) : !top ? (
        <div class="empty">
          <Icon name="search" />
          <p>No results for "{debounced}". Check the spelling, or try fewer words.</p>
        </div>
      ) : (
        <div class="search-top">
          <section>
            <h2 class="m-section">Top result</h2>
            {topArtist ? (
              <div class="top-result" onClick={() => onOpen({ kind: "artist", id: topArtist.id })} role="button" tabIndex={0}>
                {topArtist.picture && <img class="round" src={topArtist.picture} alt="" />}
                <strong>{topArtist.name}</strong>
                <span class="m-sub">Artist · {SOURCE_LABEL[topArtist.id.startsWith("sr:") ? "soundcloud" : "ytmusic"]}</span>
                <PlayFab label={`Open ${topArtist.name}`} onClick={() => onOpen({ kind: "artist", id: topArtist.id, autoplay: true })} />
              </div>
            ) : (
              <div class="top-result" onClick={() => playTrack(top, songs.length ? songs : cloudSongs)} role="button" tabIndex={0}>
                {top.album?.cover && <img src={top.album.cover} alt="" />}
                <strong>{top.title}</strong>
                <span class="m-sub">
                  Song · <ArtistLink artist={top.artist} /> · {SOURCE_LABEL[top.source] || ""}
                </span>
                <PlayFab active={nowPlaying.value?.id === top.id} onClick={() => playTrack(top, songs.length ? songs : cloudSongs)} />
              </div>
            )}
          </section>
          <section>
            <h2 class="m-section">Songs <span class="source-tag">YouTube Music</span></h2>
            <TrackTable tracks={(songs.length ? songs : cloudSongs).slice(0, 5)} showAlbum={false} />
          </section>
        </div>
      )}
      {songs.length > 5 && (
        <>
          <h2 class="m-section">More from YouTube Music</h2>
          <TrackTable tracks={songs.slice(5, 15)} />
        </>
      )}
      {cloudSongs.length > 0 && (
        <>
          <h2 class="m-section">On SoundCloud <span class="source-tag">SoundCloud</span></h2>
          <TrackTable tracks={cloudSongs.slice(0, 15)} showAlbum={false} />
        </>
      )}
      {[...(artists.data?.items || []).slice(0, 6), ...(cloudArtists.data?.items || []).slice(0, 4)].length > 0 && (
        <section class="shelf">
          <h2>Artists</h2>
          <div class="shelf-row">
            {[...(artists.data?.items || []).slice(0, 6), ...(cloudArtists.data?.items || []).slice(0, 4)].map((artist) => (
              <ArtistCard key={artist.id} artist={artist} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
      {(albums.data?.items || []).length > 0 && (
        <section class="shelf">
          <h2>Albums</h2>
          <div class="shelf-row">
            {albums.data.items.slice(0, 8).map((album) => (
              <AlbumCard key={album.id} album={album} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function BackButton() {
  return (
    <button class="btn ghost sm c-back" onClick={goBack}>
      <Icon name="back" size={16} /> Back
    </button>
  );
}

const DISCOGRAPHY = [
  ["all", "All"],
  ["albums", "Albums"],
  ["singles", "Singles & EPs"],
];

function ArtistView({ view: current }) {
  const { data, error } = useData(`/api/music/artist/${encodeURIComponent(current.id)}`);
  const [morePopular, setMorePopular] = useState(false);
  const [allSongs, setAllSongs] = useState(false);
  const [filter, setFilter] = useState("all");

  const popular = data?.popular || [];
  const tracks = data?.tracks?.length ? data.tracks : popular;
  useEffect(() => {
    if (current.autoplay && popular.length) playTrack(popular[0], popular);
  }, [popular.length > 0]);

  if (!data) {
    return (
      <div class="collection-view">
        <div class="c-hero">
          <BackButton />
          {error ? <p class="muted">{error}</p> : <div class="spinner" />}
        </div>
      </div>
    );
  }

  const { artist, albums = [], singles = [], related = [] } = data;
  const byYear = (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0);
  const releases = filter === "albums" ? albums : filter === "singles" ? singles : [...albums, ...singles].sort(byYear);
  const following = isFollowing(artist);
  const playingHere = tracks.some((track) => track.id === nowPlaying.value?.id) && playing.value;
  const stats = [artist.followers, tracks.length && `${tracks.length}${tracks.length >= 100 ? "+" : ""} songs`, albums.length && `${albums.length} album${albums.length === 1 ? "" : "s"}`].filter(Boolean);

  return (
    <div class="artist-view">
      <header class={`a-hero ${artist.banner ? "has-banner" : ""}`} style={artist.banner ? { "--banner": `url("${artist.banner}")` } : undefined}>
        <BackButton />
        <div class="a-head">
          <span class="a-photo">{artist.picture ? <img src={artist.picture} alt="" /> : <Icon name="user" size={56} />}</span>
          <div class="a-text">
            <span class="a-kind">
              <Icon name="check" size={13} stroke={2.4} /> Artist · {SOURCE_LABEL[artist.source] || ""}
            </span>
            <h1>{artist.name}</h1>
            <span class="m-sub">{stats.join(" · ")}</span>
          </div>
        </div>
      </header>

      <div class="c-actions">
        <PlayFab label={playingHere ? "Pause" : `Play ${artist.name}`} active={playingHere} onClick={() => (playingHere ? toggle() : popular[0] && playTrack(popular[0], popular))} />
        <button
          class={`c-icon ${shuffle.value ? "on" : ""}`}
          aria-label="Shuffle play"
          data-tip="Shuffle play"
          onClick={() => {
            if (!shuffle.value) toggleShuffle();
            if (tracks.length) playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks);
          }}
        >
          <Icon name="shuffle" size={22} />
        </button>
        <button class={`btn ghost follow-btn ${following ? "on" : ""}`} onClick={() => toggleFollow(artist)}>
          {following ? "Following" : "Follow"}
        </button>
      </div>

      {popular.length > 0 && (
        <section>
          <h2 class="m-section">Popular</h2>
          <TrackTable tracks={popular.slice(0, morePopular ? 10 : 5)} showPlays={popular.some((track) => track.plays)} />
          {popular.length > 5 && (
            <button class="see-more" onClick={() => setMorePopular(!morePopular)}>
              {morePopular ? "Show less" : "See more"}
            </button>
          )}
        </section>
      )}

      {albums.length + singles.length > 0 && (
        <section class="shelf">
          <h2>Discography</h2>
          <div class="chip-row" role="tablist">
            {DISCOGRAPHY.filter(([key]) => key === "all" || (key === "albums" ? albums.length : singles.length)).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={filter === key} class={`chip ${filter === key ? "on" : ""}`} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
          <div class="shelf-row">
            {releases.map((album) => (
              <AlbumCard key={album.id} album={album} onOpen={openView} sub={[album.year, album.kind || "Album"].filter(Boolean).join(" · ")} />
            ))}
          </div>
        </section>
      )}

      {tracks.length > popular.length && (
        <section>
          <h2 class="m-section">
            All songs <span class="source-tag">{tracks.length}</span>
          </h2>
          <TrackTable tracks={allSongs ? tracks : tracks.slice(0, 10)} />
          {tracks.length > 10 && (
            <button class="see-more" onClick={() => setAllSongs(!allSongs)}>
              {allSongs ? "Show less" : `Show all ${tracks.length}`}
            </button>
          )}
        </section>
      )}

      {artist.description && (
        <section>
          <h2 class="m-section">About</h2>
          <div class={`a-about ${artist.banner ? "has-banner" : ""}`} style={artist.banner ? { "--banner": `url("${artist.banner}")` } : undefined}>
            <p>{artist.description}</p>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section class="shelf">
          <h2>Fans also like</h2>
          <div class="shelf-row">
            {related.map((entry) => (
              <ArtistCard key={entry.id} artist={entry} onOpen={openView} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Collection({ view, onBack }) {
  const remote = useData(view.kind === "album" ? `/api/music/album/${encodeURIComponent(view.id)}` : view.kind === "shelf" ? view.url : null);
  let head = null;
  let tracks = [];
  if (view.kind === "liked") {
    head = { title: "Liked Songs", kind: "Playlist", subtitle: `${likes.value.length} songs`, liked: true };
    tracks = likes.value;
  } else if (view.kind === "recent") {
    tracks = storage.get("musicRecents", []);
    head = { title: "Recently played", kind: "Playlist", subtitle: `${tracks.length} songs` };
  } else if (view.kind === "shelf") {
    tracks = remote.data?.items || [];
    head = { title: view.title, kind: "Playlist", subtitle: "Fresh from YouTube Music" };
  } else if (remote.data) {
    const info = remote.data.album;
    head = {
      title: info?.title,
      kind: info?.kind || "Album",
      artist: info?.artist,
      subtitle: [info?.year, `${remote.data.tracks.length} songs`].filter(Boolean).join(" · "),
      cover: info?.cover,
      album: info,
    };
    tracks = remote.data.tracks;
  }

  useEffect(() => {
    if (view.autoplay && tracks.length) playTrack(tracks[0], tracks);
  }, [tracks.length > 0]);

  return (
    <div class="collection-view">
      <div class="c-hero">
        <BackButton />
        {head ? (
          <div class="c-head">
            <span class={`c-cover ${head.round ? "round" : ""} ${head.liked ? "liked-art" : ""}`}>
              {head.liked ? <Icon name="heart" size={64} fill /> : head.cover ? <img src={head.cover} alt="" /> : <Icon name="music" size={48} />}
            </span>
            <div>
              <span class="m-sub">{head.kind}</span>
              <h1>{head.title}</h1>
              <span class="m-sub c-byline">
                {head.artist?.name && <ArtistLink class="c-artist" artist={head.artist} />}
                {head.artist?.name && head.subtitle && " · "}
                {head.subtitle}
              </span>
            </div>
          </div>
        ) : remote.error ? (
          <p class="muted">{remote.error}</p>
        ) : (
          <div class="spinner" />
        )}
      </div>
      {head && (
        <div class="c-actions">
          <PlayFab label="Play all" onClick={() => tracks[0] && playTrack(tracks[0], tracks)} />
          <button class={`c-icon ${shuffle.value ? "on" : ""}`} aria-label="Shuffle" data-tip="Shuffle" onClick={toggleShuffle}>
            <Icon name="shuffle" size={22} />
          </button>
          {head.album && (
            <button
              class={`c-icon ${isSavedAlbum(head.album) ? "on" : ""}`}
              aria-label={isSavedAlbum(head.album) ? "Remove from your library" : "Save to your library"}
              data-tip={isSavedAlbum(head.album) ? "Saved" : "Save to your library"}
              onClick={() => toggleSavedAlbum(head.album)}
            >
              <Icon name="heart" size={24} fill={isSavedAlbum(head.album)} />
            </button>
          )}
        </div>
      )}
      {!tracks.length && head ? (
        <div class="empty">
          <Icon name={view.kind === "liked" ? "heart" : "music"} />
          <p>{view.kind === "liked" ? "Songs you like will appear here. Tap the heart on any song." : "Nothing here yet."}</p>
        </div>
      ) : (
        <TrackTable tracks={tracks} showAlbum={view.kind !== "album"} />
      )}
    </div>
  );
}

function NowPlayingBar() {
  const track = nowPlaying.value;
  const { time, duration } = progress.value;
  const liked = track && likes.value.some((entry) => entry.id === track.id);
  return (
    <footer class={`np-bar ${track ? "" : "idle"}`} aria-label="Now playing">
      <div class="np-left">
        {track ? (
          <>
            <span class="np-art">{track.album?.cover ? <img src={track.album.cover} alt="" /> : <Icon name="music" />}</span>
            <span class="np-text">
              <span class="np-title">{track.title}</span>
              <ArtistLink class="m-sub" artist={track.artist} />
            </span>
            <button class={`c-icon small ${liked ? "on" : ""}`} aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"} onClick={() => toggleLike(track)}>
              <Icon name="heart" size={17} fill={liked} />
            </button>
          </>
        ) : (
          <span class="m-sub">Pick something to play</span>
        )}
      </div>
      <div class="np-center">
        <div class="np-controls">
          <button class={`c-icon small ${shuffle.value ? "on" : ""}`} aria-label="Shuffle" data-tip="Shuffle" data-tip-pos="up" onClick={toggleShuffle}>
            <Icon name="shuffle" size={17} />
          </button>
          <button class="c-icon small" aria-label="Previous" onClick={prev} disabled={!track}>
            <Icon name="prev" size={18} fill />
          </button>
          <button class="np-play" aria-label={playing.value ? "Pause" : "Play"} onClick={toggle} disabled={!track}>
            {loadingTrack.value ? <span class="spinner" /> : <Icon name={playing.value ? "pause" : "play"} size={18} fill />}
          </button>
          <button class="c-icon small" aria-label="Next" onClick={next} disabled={!track}>
            <Icon name="next" size={18} fill />
          </button>
          <button
            class={`c-icon small ${repeat.value !== "off" ? "on" : ""}`}
            aria-label={`Repeat: ${repeat.value}`}
            data-tip={repeat.value === "one" ? "Repeat one" : repeat.value === "all" ? "Repeat all" : "Repeat off"}
            data-tip-pos="up"
            onClick={cycleRepeat}
          >
            <Icon name="repeat" size={17} />
            {repeat.value === "one" && <span class="repeat-one">1</span>}
          </button>
        </div>
        <div class="np-progress">
          <span>{formatTime(time)}</span>
          <input
            class="np-range"
            type="range"
            min="0"
            max={duration || 1}
            step="0.5"
            value={time}
            style={{ "--fill": `${duration ? (time / duration) * 100 : 0}%` }}
            aria-label="Seek"
            onInput={(event) => seek(Number(event.currentTarget.value))}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div class="np-right">
        <button class="c-icon small" aria-label="Download" data-tip="Download" data-tip-pos="up" onClick={() => track && downloadTrack(track)} disabled={!track}>
          <Icon name="download" size={17} />
        </button>
        <button class="c-icon small" aria-label={volume.value ? "Mute" : "Unmute"} onClick={() => setVolume(volume.value ? 0 : 1)}>
          <Icon name={volume.value ? "volume" : "mute"} size={17} />
        </button>
        <input
          class="np-range np-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume.value}
          style={{ "--fill": `${volume.value * 100}%` }}
          aria-label="Volume"
          onInput={(event) => setVolume(Number(event.currentTarget.value))}
        />
      </div>
    </footer>
  );
}

export function Music() {
  const [tab, setTab] = useState("home");
  const [query, setQuery] = useState("");
  const current = view.value;
  const open = openView;
  const setView = closeViews;

  return (
    <main class="spotify">
      <aside class="sp-side">
        <nav class="sp-panel glass">
          <button class={`sp-nav ${tab === "home" && !current ? "active" : ""}`} onClick={() => (setTab("home"), setView())}>
            <Icon name="home" size={22} /> Home
          </button>
          <button class={`sp-nav ${tab === "search" && !current ? "active" : ""}`} onClick={() => (setTab("search"), setView())}>
            <Icon name="search" size={22} /> Search
          </button>
        </nav>
        <div class="sp-panel glass sp-library">
          <div class="sp-lib-head">
            <Icon name="list" size={20} /> Your Library
          </div>
          <button class="lib-item" onClick={() => open({ kind: "liked" })}>
            <span class="lib-art liked-art">
              <Icon name="heart" size={16} fill />
            </span>
            <span class="lib-text">
              <span>Liked Songs</span>
              <span class="m-sub">Playlist · {likes.value.length} songs</span>
            </span>
          </button>
          <button class="lib-item" onClick={() => open({ kind: "recent" })}>
            <span class="lib-art">
              <Icon name="clock" size={16} />
            </span>
            <span class="lib-text">
              <span>Recently played</span>
              <span class="m-sub">Playlist</span>
            </span>
          </button>
          {savedAlbums.value.map((album) => (
            <button key={album.id} class="lib-item" onClick={() => open({ kind: "album", id: album.id })}>
              <span class="lib-art">{album.cover && <img src={album.cover} alt="" />}</span>
              <span class="lib-text">
                <span>{album.title}</span>
                <span class="m-sub">Album · {album.artist?.name}</span>
              </span>
            </button>
          ))}
          {followedArtists.value.map((artist) => (
            <button key={artist.id} class="lib-item" onClick={() => open({ kind: "artist", id: artist.id })}>
              <span class="lib-art round">{artist.picture ? <img src={artist.picture} alt="" /> : <Icon name="user" size={16} />}</span>
              <span class="lib-text">
                <span>{artist.name}</span>
                <span class="m-sub">Artist</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section class="sp-main glass">
        {tab === "search" && !current && (
          <label class="searchbox sp-search">
            <Icon name="search" />
            <input autoFocus placeholder="What do you want to listen to?" value={query} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search music" />
          </label>
        )}
        <div class="sp-scroll">
          {current?.kind === "artist" ? (
            <ArtistView key={`artist-${current.id}`} view={current} />
          ) : current ? (
            <Collection key={`${current.kind}-${current.id || current.url || ""}`} view={current} />
          ) : tab === "search" ? (
            <Search query={query} onOpen={open} />
          ) : (
            <Home onOpen={open} />
          )}
        </div>
      </section>

      <NowPlayingBar />
    </main>
  );
}
