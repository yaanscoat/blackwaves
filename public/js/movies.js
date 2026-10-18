import { engine } from "./engine.js";

export const moviesUrl = "https://reaperm.up.railway.app/";

// The page is cross-origin isolated, so a plain cross-origin iframe is
// refused. Chromium's credentialless iframes get around that directly; other
// browsers load the site through the proxy instead.
const direct = "credentialless" in HTMLIFrameElement.prototype;

export const createMovies = ({ toast }) => {
    const host = document.querySelector("#movies-frame-host");
    const status = document.querySelector("#movies-status");
    let frame = null;
    let session = null;

    const mount = async () => {
        if (frame)
            return;
        frame = document.createElement("iframe");
        frame.className = "movies-frame";
        frame.title = "Movies";
        frame.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
        frame.setAttribute("allowfullscreen", "");
        frame.addEventListener("load", () => (status.hidden = true));
        host.append(frame);
        status.hidden = false;
        if (direct) {
            frame.credentialless = true;
            frame.setAttribute("credentialless", "");
            frame.referrerPolicy = "no-referrer";
            frame.src = moviesUrl;
            return;
        }
        try {
            session = await engine.createSession(frame, {
                ready: () => (status.hidden = true),
                error: error => toast(error?.message ?? String(error))
            });
            session.go(moviesUrl);
        }
        catch (error) {
            status.textContent = `Movies could not load: ${error.message}`;
        }
    };

    document.querySelector("#movies-reload").addEventListener("click", () => {
        if (session)
            session.reload();
        else if (frame)
            frame.src = moviesUrl;
    });
    document.querySelector("#movies-fullscreen").addEventListener("click", () => {
        frame?.requestFullscreen?.().catch(() => toast("Fullscreen was blocked."));
    });

    return { show: () => void mount() };
};
