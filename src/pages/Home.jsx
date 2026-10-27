import { useEffect, useState } from "preact/hooks";
import { Icon } from "../components/Icon.jsx";
import { SearchBox } from "../components/SearchBox.jsx";
import { Bookmarks } from "../components/Bookmarks.jsx";
import { NativeAd, SponsorLink } from "../components/Ads.jsx";
import { randomSearchMessage } from "../data/catalogs.js";
import { openInBrowser } from "../lib/browser.js";
import { resolveInput } from "../lib/search.js";
import { barrelRoll, logoClicked } from "../lib/easter.js";
import { me, canClaimDaily, claimDaily } from "../lib/account.js";
import { navigate } from "../lib/router.js";
import { recents } from "../lib/games/catalog.js";
import { storage } from "../lib/storage.js";
import { toast } from "../lib/notify.js";

/** types the placeholder out one letter at a time, then picks another message */
function useTypedMessage() {
  const [text, setText] = useState("");
  useEffect(() => {
    let message = randomSearchMessage();
    let i = 0;
    let deleting = false;
    let timer;
    const tick = () => {
      if (!deleting) {
        i++;
        setText(message.slice(0, i));
        if (i >= message.length) {
          deleting = true;
          timer = setTimeout(tick, 4200);
          return;
        }
        timer = setTimeout(tick, 45 + Math.random() * 50);
      } else {
        i -= 2;
        setText(message.slice(0, Math.max(0, i)));
        if (i <= 0) {
          deleting = false;
          message = randomSearchMessage();
          timer = setTimeout(tick, 400);
          return;
        }
        timer = setTimeout(tick, 18);
      }
    };
    timer = setTimeout(tick, 500);
    return () => clearTimeout(timer);
  }, []);
  return text;
}

export function Home() {
  const placeholder = useTypedMessage();
  const user = me.value;
  const lastGame = recents.value[0];
  const watching = storage.get("watchProgress", [])[0];

  const search = (text) => {
    if (/^do a barrel roll$/i.test(text)) return barrelRoll();
    openInBrowser(resolveInput(text));
  };

  return (
    <main class="home">
      <section class="hero">
        <button class="hero-logo" onClick={(event) => logoClicked(event.clientX, event.clientY)} aria-label="blackwaves logo (try clicking it)">
          <img class="logo-img" src="/favicon.ico" alt="" width="132" height="86" />
        </button>
        <h1 class="wordmark" aria-label="blackwaves">
          {"blackwaves".split("").map((char, index) => (
            <span key={index} style={{ "--i": index }}>
              {char}
            </span>
          ))}
        </h1>
        <SearchBox big placeholder={placeholder || " "} onSubmit={search} />
        <Bookmarks onOpen={(url) => openInBrowser(url)} />

        {(lastGame || watching || (user && canClaimDaily(user))) && (
          <div class="jump-back">
            {user && canClaimDaily(user) && (
              <button class="chip daily-chip" onClick={() => claimDaily().catch((error) => toast(error.message, { kind: "error" }))}>
                <Icon name="gift" size={15} /> Claim your daily coins
              </button>
            )}
            {lastGame && (
              <button class="chip" onClick={() => navigate(`/games?play=${encodeURIComponent(lastGame.key)}`)}>
                <Icon name="games" size={15} /> {lastGame.name}
              </button>
            )}
            {watching && (
              <button class="chip" onClick={() => navigate(`/movies/${watching.type}/${watching.id}`)}>
                <Icon name="movies" size={15} /> {watching.title}
                {watching.type === "tv" ? ` S${watching.season}E${watching.episode}` : ""}
              </button>
            )}
          </div>
        )}
      </section>
      <NativeAd class="home-ad" />
      <SponsorLink />
    </main>
  );
}
