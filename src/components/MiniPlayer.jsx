import { Icon } from "./Icon.jsx";
import { nowPlaying, playing, progress, loadingTrack, toggle, next, prev, seek, stop, formatTime, likes, toggleLike } from "../lib/player.js";
import { navigate, section, route } from "../lib/router.js";

export function MiniPlayer() {
  const track = nowPlaying.value;
  // the music page has its own full-width bar, and the browser wants every pixel
  if (!track || ["browser", "music"].includes(section(route.value))) return null;
  const { time, duration } = progress.value;
  const liked = likes.value.some((entry) => entry.id === track.id);
  return (
    <div class="mini-player glass liquid" role="region" aria-label="Now playing">
      <button class="mini-art" onClick={() => navigate("/music")} aria-label="Open music">
        {track.album?.cover ? <img src={track.album.cover} alt="" /> : <Icon name="music" />}
        {playing.value && (
          <span class="eq" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      <div class="mini-info">
        <span class="mini-title">{track.title}</span>
        <span class="muted small">{track.artist?.name}</span>
        <input
          class="mini-seek range"
          type="range"
          min="0"
          max={duration || 1}
          step="0.5"
          value={time}
          aria-label="Seek"
          onInput={(event) => seek(Number(event.currentTarget.value))}
        />
        <span class="mini-time faint">
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>
      <div class="mini-controls">
        <button class="btn ghost icon-only sm" aria-label={liked ? "Unlike" : "Like"} onClick={() => toggleLike(track)}>
          <Icon name="heart" size={16} fill={liked} />
        </button>
        <button class="btn ghost icon-only sm" aria-label="Previous" onClick={prev}>
          <Icon name="prev" size={16} />
        </button>
        <button class="btn primary icon-only" aria-label={playing.value ? "Pause" : "Play"} onClick={toggle}>
          {loadingTrack.value ? <span class="spinner" /> : <Icon name={playing.value ? "pause" : "play"} size={18} fill />}
        </button>
        <button class="btn ghost icon-only sm" aria-label="Next" onClick={next}>
          <Icon name="next" size={16} />
        </button>
        <button class="btn ghost icon-only sm" aria-label="Close player" onClick={stop}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
