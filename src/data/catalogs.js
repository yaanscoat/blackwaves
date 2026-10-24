// small lookup tables that don't deserve their own files

export const ENGINES = [
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  { id: "startpage", name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
  { id: "ecosia", name: "Ecosia", url: "https://www.ecosia.org/search?q=%s" },
  { id: "qwant", name: "Qwant", url: "https://www.qwant.com/?q=%s" },
  { id: "yahoo", name: "Yahoo", url: "https://search.yahoo.com/search?p=%s" },
  { id: "mojeek", name: "Mojeek", url: "https://www.mojeek.com/search?q=%s" },
  { id: "yandex", name: "Yandex", url: "https://yandex.com/search/?text=%s" },
];

export const CLOAKS = [
  { id: "none", name: "None (blackwaves)", title: "blackwaves", icon: "/favicon.ico" },
  { id: "classroom", name: "Google Classroom", title: "Home - Classroom", icon: "https://ssl.gstatic.com/classroom/favicon.png" },
  { id: "docs", name: "Google Docs", title: "Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon-2023q4.ico" },
  { id: "drive", name: "Google Drive", title: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" },
  { id: "google", name: "Google", title: "Google", icon: "https://www.google.com/favicon.ico" },
  { id: "gmail", name: "Gmail", title: "Inbox - Gmail", icon: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico" },
  { id: "canvas", name: "Canvas", title: "Dashboard", icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico" },
  { id: "schoology", name: "Schoology", title: "Home | Schoology", icon: "https://asset-cdn.schoology.com/sites/all/themes/schoology_theme/favicon.ico" },
  { id: "clever", name: "Clever", title: "Clever | Portal", icon: "https://assets.clever.com/launchpad/2e2b6fd2/favicon.ico" },
  { id: "khan", name: "Khan Academy", title: "Dashboard | Khan Academy", icon: "https://cdn.kastatic.org/images/favicon.ico" },
  { id: "desmos", name: "Desmos", title: "Desmos | Graphing Calculator", icon: "https://www.desmos.com/assets/img/apps/graphing/favicon.ico" },
  { id: "quizlet", name: "Quizlet", title: "Your Library | Quizlet", icon: "https://assets.quizlet.com/a/j/dist/i/favicon.6e263725c926227.ico" },
  { id: "wikipedia", name: "Wikipedia", title: "Wikipedia, the free encyclopedia", icon: "https://en.wikipedia.org/static/favicon/wikipedia.ico" },
  { id: "youtube", name: "YouTube", title: "YouTube", icon: "https://www.youtube.com/s/desktop/014dbbed/img/favicon_32x32.png" },
  { id: "zoom", name: "Zoom", title: "Zoom", icon: "https://st1.zoom.us/zoom.ico" },
  { id: "kahoot", name: "Kahoot!", title: "Kahoot!", icon: "https://kahoot.it/favicon.ico" },
];

export const DEFAULT_BOOKMARKS = [
  { title: "YouTube", url: "https://www.youtube.com" },
  { title: "Spotify", url: "https://open.spotify.com" },
  { title: "Snapchat", url: "https://web.snapchat.com" },
  { title: "GitHub", url: "https://github.com" },
  { title: "Wikipedia", url: "https://www.wikipedia.org" },
];

export const SEARCH_MESSAGES = [
  "hellow!?",
  "welcome black",
  "yellow-boys",
  "made in.. REACT?",
  "i made this website by vibe-coding",
  "clawd code so beautiful",
  "it's a good day nananananananananananana",
  "ocean the real mvp dawg",
  "made with <3 by yaanscoat and beery-tomato",
  "i luv u",
  "Hello, my son is a watermelon.",
];

// this one is exactly as rare as it claims to be
export const ULTRA_RARE_MESSAGE = "you have a 0.00001% chance of getting this message";
export const ULTRA_RARE_ODDS = 0.0000001;

export function randomSearchMessage() {
  if (Math.random() < ULTRA_RARE_ODDS) return ULTRA_RARE_MESSAGE;
  return SEARCH_MESSAGES[Math.floor(Math.random() * SEARCH_MESSAGES.length)];
}

export const DISCORD = "https://discord.gg/dZPVgBu3AS";
