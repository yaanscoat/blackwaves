import { toasts, dismissToast } from "../lib/notify.js";

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((entry) => (
        <div key={entry.id} class={`toast glass ${entry.kind} ${entry.leaving ? "leaving" : ""}`}>
          <span class="dot" />
          <span>{entry.message}</span>
          {entry.action && (
            <button
              class="btn sm"
              onClick={() => {
                entry.action.run();
                dismissToast(entry.id);
              }}
            >
              {entry.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
