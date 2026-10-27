export const VERSION = typeof __BW_VERSION__ !== "undefined" ? __BW_VERSION__ : "3.0.0";

export const CHANGELOG = [
  {
    version: "3.0.0",
    title: "The big one",
    groups: [
      {
        label: "New",
        items: [
          "Rebuilt the backend in JavaScript: the Wisp proxy, the game proxy and CloudSync now run together in one Node.js server.",
          "New top bar with Home, Browser, Games and Movies, plus Alt+H, Alt+B, Alt+G and Alt+M shortcuts.",
          "Movies & shows page with search, genres, seasons and episodes, continue watching and a choice of players.",
          "Liquid glass across the top bar, cards, menus and popups.",
          "Browser mode (beta) in Appearance makes blackwaves look like a normal browser.",
          "11 particle modes, 12 animated backgrounds, your own image or video background, accent colors, cursor trails and click sparks.",
          "Everything blackwaves saves on your device is now encrypted, with the key kept in a cookie. Clearing your cookies resets blackwaves.",
          "Cookie choices on the welcome screen, plus a Privacy Policy, Terms of Service, Cookie Policy and DMCA page.",
          "Credits is now About, with the version, this changelog and the team.",
          "An online counter next to the server location.",
          "New default bookmarks: YouTube, Spotify, Snapchat, GitHub and Wikipedia.",
          "Music from YouTube Music and SoundCloud (Spotify-style, with liked songs, looping and downloads), manga and cloud gaming pages, a Discord-style chat with channels and DMs, profiles, coins and a shop for decorations and titles.",
          "Artist profiles in Music: popular songs, every album, single and song, an About section and similar artists. Click any artist name to open one, and follow artists to keep them in your library.",
          "Three new game sources: UGS, CKV and Seraph.",
          "Choose what shows in the top bar under Appearance. Anything you hide moves into the menu button.",
          "blackwaves AI: chat with free AI models (Alt+A). Chats stay on your device.",
          "Much lighter server: downloads are put together on your device, pages and game files are cached by your browser, and the server keeps itself under 3 GB of memory even with 300 people on at once.",
          "New icons from Font Awesome, plus a round of UI polish.",
          "Music no longer hits YouTube's \"sign in to confirm you're not a bot\" wall on most servers, songs play all the way through again, and if YouTube still refuses, the same song plays from SoundCloud.",
        ],
      },
      {
        label: "Bug fixes",
        items: [
          "Fixed the site loading blank after an update (browsers kept old files for up to a year).",
          "Fixed links and searches in the browser sometimes opening a 404 page.",
          "Fixed the game list after gn-math moved, and removed the Squall source, which no longer exists.",
          "Fixed games that load files from their own site showing a blank screen.",
          "Movies play in a built-in player again, with four sources to switch between (videasy, vidsrc, 2embed and vidlink). The old sources had moved, shut down or stopped working through the proxy.",
          "Fixed CloudSync never noticing changed settings, and the junk \"setItem\" entries it left in storage.",
          "Your CloudSync login is no longer sent to websites you open through the proxy.",
          "The proxy can no longer be used to reach the server's private network.",
          "Removed leftover ad and analytics scripts.",
        ],
      },
    ],
  },
  {
    version: "2.5",
    title: "Top bar era",
    groups: [
      {
        label: "Changes",
        items: [
          "The dock is now a full top bar with the blackwaves name, and it folds into a three-line menu.",
          "Notifications live behind the bell in the top bar.",
          "Click the logo on the home page for confetti.",
          "Flatter look with Lexend everywhere, plus smoother page, toast and menu animations.",
        ],
      },
    ],
  },
  {
    version: "2.0",
    title: "The glass dock",
    groups: [
      {
        label: "New",
        items: [
          "New home page with the floating liquid-glass dock.",
          "Games: over 4,000 titles from gn-math, Seraph, Truffled, CKV and UGS, with favorites and recents.",
          "Apps, Movies and a tabbed proxy browser with ten search engines (DuckDuckGo first).",
          "Settings moved into this popup.",
          "52 themes, adjustable liquid glass and four motion levels.",
          "Three hidden light sources with dust, plus snow, rain, fire sparks, plain black or your own background.",
          "15 tab cloaks with about:blank and blob: launching, including auto-launch.",
          "CloudSync accounts that carry settings, history, cookies and backgrounds between devices.",
        ],
      },
    ],
  },
  {
    version: "1.0",
    title: "Day one",
    groups: [{ label: "New", items: ["First release: Scramjet proxy with libcurl, epoxy and bare transports."] }],
  },
];

export const TEAM = [
  { name: "yaanscoat", role: "Made blackwaves", url: "https://github.com/yaanscoat" },
  { name: "beery-tomato", role: "Also made blackwaves", url: "https://github.com/beery-tomato" },
];

export const CREDITS = [
  { name: "lyra by gayq", what: "the codebase blackwaves 3.0 is built on", url: "https://github.com/gayq/lyra" },
  { name: "x8rr/movies", what: "movies & shows API", url: "https://github.com/x8rr/movies" },
  { name: "x8rr/manga", what: "manga API (MangaDex + MangaPill)", url: "https://github.com/x8rr/manga" },
  { name: "x8rr/stratus-api", what: "cloud gaming catalog", url: "https://github.com/x8rr/stratus-api" },
  { name: "edideaur/monochrome", what: "where blackwaves music started", url: "https://github.com/edideaur/monochrome" },
  { name: "YouTube.js by LuanRT", what: "YouTube Music search and playback", url: "https://github.com/LuanRT/YouTube.js" },
  { name: "SoundCloud", what: "the other half of music search", url: "https://soundcloud.com" },
  { name: "TMDB", what: "movie and show metadata", url: "https://www.themoviedb.org" },
  { name: "Mercury Workshop", what: "Scramjet, Wisp, epoxy and libcurl", url: "https://github.com/MercuryWorkshop" },
  { name: "x8rr/sapphire", what: "the base of lyra's extension runtime", url: "https://github.com/x8rr/sapphire" },
  { name: "gn-math, Selenite, Truffled, Edurocks, wasm.rip, Velara, gmshelf", what: "game sources", url: "https://github.com/gn-math" },
  { name: "Font Awesome Free", what: "every icon (CC BY 4.0)", url: "https://fontawesome.com" },
  { name: "Lexend", what: "the only font we use", url: "https://www.lexend.com" },
  { name: "oneko", what: "the cat (you'll find it)", url: "https://github.com/adryd325/oneko.js" },
];
