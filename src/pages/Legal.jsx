import { Icon } from "../components/Icon.jsx";
import { navigate, route, segments } from "../lib/router.js";
import { DISCORD } from "../data/catalogs.js";
import "../styles/social.css";

const UPDATED = "October 30, 2026";

const DOCS = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      ["What we collect", "If you just use blackwaves, we don't collect anything that identifies you. The server sees your IP address while it relays your traffic, the same way any website does, and it keeps short-lived rate-limit counters in memory. We don't run ads or analytics."],
      ["What stays on your device", "Settings, history, bookmarks, favorites and backgrounds are stored in your browser, encrypted with a key that lives in a cookie. We can't read them. Clearing your cookies deletes the key, which makes the data unreadable and resets blackwaves."],
      ["CloudSync accounts", "If you make an account, we store your username, a hashed password (scrypt), your profile, coins, shop items, the data you choose to sync, and the chat messages you send. You can delete your account and all of that in Settings > CloudSync."],
      ["Chat", "Messages in public channels can be read by anyone using blackwaves. Direct messages are only shown to the two people in them, but they are stored on our server and are not end-to-end encrypted. Don't share anything sensitive."],
      ["The proxy", "Pages you open through the browser or the game proxy are fetched through our server. We don't log which sites you visit. Your blackwaves login cookie is never forwarded to them."],
      ["Third parties", "Movies, music, manga, AI and cloud gaming data come from TMDB, embed players, YouTube Music, SoundCloud, OpenRouter, MangaDex and MangaPill. Messages you send to blackwaves AI, text you paraphrase or humanize and files you attach to a chat are passed through our server to OpenRouter and the model provider that answers. We don't keep them. Embed players load from their own servers and have their own policies."],
      ["Contact", `Questions? Find us on Discord: ${DISCORD}`],
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      ["Using blackwaves", "blackwaves is provided as-is, for free, with no warranty. Use it at your own risk and follow the rules of whatever network you're on. You're responsible for what you do with it."],
      ["Be decent", "No harassment, hate, threats, spam, scams, doxxing or illegal content in chat or on profiles. Don't try to break the servers, abuse the proxy to attack other sites, or reach private networks. We can delete messages and ban accounts that break these rules."],
      ["Accounts and coins", "One person, one account. Coins and shop items have no cash value, can't be bought with real money, can't be transferred, and can be reset if we find exploits. If the economy breaks, we'll fix it; your pink cat ears may be at the mercy of a bug fix."],
      ["Content", "Games, movies, music and manga are provided by third-party sources. We don't host that content. See the DMCA page if you own something and want it removed."],
      ["Changes", "We can change these terms. If you keep using blackwaves after a change, you accept the new version."],
    ],
  },
  cookies: {
    title: "Cookie Policy",
    sections: [
      ["Essential cookies", "bw_k holds the key that encrypts everything blackwaves saves on your device. bw_session keeps you signed in to CloudSync; it's only sent to our /api, never to sites you open through the proxy. bw_consent remembers your cookie choices."],
      ["Game cookies", "Games opened through the game proxy can set their own cookies so saves and logins work. They're scoped to our site and never include ours."],
      ["Optional choices", "The online counter and search suggestions are optional. Turn them off on the welcome screen, or later in Settings > Privacy & cloaking. We don't use advertising or analytics cookies."],
      ["Clearing cookies", "Deleting your cookies removes the encryption key, so everything blackwaves saved on that device is reset. Your CloudSync account is untouched; sign back in to restore synced data."],
    ],
  },
  dmca: {
    title: "DMCA",
    sections: [
      ["We don't host it", "blackwaves doesn't store games, movies, music or manga. It aggregates and proxies content from third-party sources that are publicly available."],
      ["Takedown requests", `If you own content that appears through blackwaves and want it removed from our catalogs, contact us on Discord (${DISCORD}) with: the content and where it appears, proof that you own it or act for the owner, your contact details, and a statement that the information is accurate.`],
      ["What happens next", "We'll remove or block the listed content from our catalogs and proxy as quickly as we reasonably can, and let you know when it's done. For content hosted elsewhere, we'll also point you to the original source."],
    ],
  },
};

export function Legal() {
  const [, doc = "privacy"] = segments(route.value);
  const page = DOCS[doc] || DOCS.privacy;
  return (
    <main class="page legal-page">
      <div class="legal-tabs chips">
        {Object.entries(DOCS).map(([id, entry]) => (
          <button key={id} class="chip" aria-pressed={DOCS[doc] ? doc === id : id === "privacy"} onClick={() => navigate(`/legal/${id}`)}>
            {entry.title}
          </button>
        ))}
      </div>
      <article class="legal glass">
        <h1>{page.title}</h1>
        <p class="faint small">Last updated {UPDATED}</p>
        {page.sections.map(([heading, body]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{body}</p>
          </section>
        ))}
        <button class="btn" onClick={() => (history.length > 1 ? history.back() : navigate("/"))}>
          <Icon name="back" size={16} /> Back
        </button>
      </article>
    </main>
  );
}
