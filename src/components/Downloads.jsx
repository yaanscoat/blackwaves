import { Icon } from "./Icon.jsx";
import { downloads, cancelDownload } from "../lib/hlsdownload.js";

const LABEL = { starting: "Starting...", done: "Saved", cancelled: "Cancelled" };

/** the little stack of in-progress downloads in the bottom-left corner */
export function Downloads() {
  const list = downloads.value;
  if (!list.length) return null;
  return (
    <div class="downloads" role="status" aria-live="polite">
      {list.map((entry) => (
        <div key={entry.id} class={`download glass ${entry.state}`}>
          <Icon name={entry.state === "done" ? "check" : entry.state === "failed" ? "info" : "download"} size={16} />
          <div class="download-text">
            <span class="download-name">{entry.name}</span>
            <span class="download-state">
              {entry.state === "downloading" ? `${Math.round(entry.progress * 100)}%` : entry.state === "failed" ? entry.error : LABEL[entry.state]}
            </span>
            {entry.state === "downloading" && (
              <span class="download-bar">
                <i style={{ width: `${entry.progress * 100}%` }} />
              </span>
            )}
          </div>
          {(entry.state === "downloading" || entry.state === "starting") && (
            <button class="download-cancel" aria-label={`Cancel ${entry.name}`} data-tip="Cancel" onClick={() => cancelDownload(entry.id)}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
