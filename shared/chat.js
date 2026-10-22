export const CHANNELS = [
  { id: "announcements", name: "announcements", topic: "news from the people who break things", readOnly: true },
  { id: "general", name: "general", topic: "say hi. be nice. no really, be nice." },
  { id: "games", name: "games", topic: "high scores, rage quits and game requests" },
  { id: "movies", name: "movies", topic: "what are we watching tonight" },
  { id: "music", name: "music", topic: "share the aux" },
  { id: "manga", name: "manga", topic: "no spoilers without spoiler tags pls" },
  { id: "memes", name: "memes", topic: "quality not guaranteed" },
  { id: "help", name: "help", topic: "something broke? tell us here" },
];

export const CHANNEL_IDS = new Set(CHANNELS.map((channel) => channel.id));

export const MESSAGE_MAX = 2000;

export const REACTIONS = ["👍", "😂", "❤️", "🔥", "😭", "💀", "👀", "🎉"];

/** dm channel ids are "dm:<smaller id>:<bigger id>" so both people land in the same room */
export function dmChannel(a, b) {
  const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n);
  return `dm:${x}:${y}`;
}

export function dmMembers(channel) {
  const match = /^dm:(\d+):(\d+)$/.exec(channel);
  return match ? [Number(match[1]), Number(match[2])] : null;
}
