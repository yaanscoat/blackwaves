// the shop catalog. shared by the server (which charges you) and the client
// (which shows you what you can't afford yet).
//
// pricing rule: normal stuff sits around 300 coins. anything with a cat,
// fox, deer or anime in it starts above 1,000, and the pink cat ears are the
// most expensive thing in the building. no, there is no discount code.

export const DECORATIONS = [
  { id: "pink-cat-ears", name: "Pink Cat Ears", price: 7500, rarity: "mythic", file: "pink-cat-ears.gif", tags: ["cat"] },
  { id: "emo-cat-ears", name: "Emo Cat Ears", price: 2400, rarity: "legendary", file: "emo-cat-ears.gif", tags: ["cat"] },
  { id: "yellow-kitty-cat", name: "Yellow Kitty Cat", price: 2100, rarity: "legendary", file: "yellow-kitty-cat.gif", tags: ["cat"] },
  { id: "angry-anime", name: "Angry Anime", price: 1800, rarity: "epic", file: "angry-anime.gif", tags: ["anime"] },
  { id: "chill-deer", name: "Chill Deer", price: 1600, rarity: "epic", file: "chill-deer.gif", tags: ["deer"] },
  { id: "nani", name: "Nani!?", price: 1350, rarity: "epic", file: "nani!.gif", tags: ["anime"] },
  { id: "sakura", name: "Sakura", price: 340, rarity: "rare", file: "sakura.gif", tags: [] },
  { id: "streen-fighter", name: "Street Fighter", price: 330, rarity: "rare", file: "streen-fighter.gif", tags: [] },
  { id: "angel-n-hearts", name: "Angel n' Hearts", price: 320, rarity: "rare", file: "angel-n-hearts.gif", tags: [] },
  { id: "the-ring-of-steel", name: "The Ring of Steel", price: 310, rarity: "rare", file: "the-ring-of-steel.gif", tags: [] },
  { id: "ghost", name: "Ghost", price: 300, rarity: "common", file: "ghost.gif", tags: [] },
  { id: "purple-stones", name: "Purple Stones", price: 300, rarity: "common", file: "purple-stones.gif", tags: [] },
  { id: "nervous-breakdown", name: "Nervous Breakdown", price: 290, rarity: "common", file: "nervous-breakdown.gif", tags: [] },
  { id: "ramen-bowl", name: "Ramen Bowl", price: 280, rarity: "common", file: "ramen-bowl.gif", tags: [] },
];

export const TITLES = [
  { id: "t-anime-protagonist", name: "Anime Protagonist", price: 1900, rarity: "legendary", tags: ["anime"] },
  { id: "t-kitsune", name: "Kitsune", price: 1700, rarity: "epic", tags: ["fox"] },
  { id: "t-cat-person", name: "Certified Cat Person", price: 1500, rarity: "epic", tags: ["cat"] },
  { id: "t-deer-whisperer", name: "Deer Whisperer", price: 1400, rarity: "epic", tags: ["deer"] },
  { id: "t-sly-fox", name: "Sly Fox", price: 1250, rarity: "epic", tags: ["fox"] },
  { id: "t-weeb", name: "Professional Anime Watcher", price: 1150, rarity: "epic", tags: ["anime"] },
  { id: "t-og", name: "Blackwaves OG", price: 450, rarity: "rare", tags: [] },
  { id: "t-ocean", name: "Ocean's Real MVP", price: 400, rarity: "rare", tags: [] },
  { id: "t-main-character", name: "Main Character", price: 350, rarity: "rare", tags: [] },
  { id: "t-vibe-coder", name: "Vibe Coder", price: 330, rarity: "rare", tags: [] },
  { id: "t-watermelon", name: "Watermelon Parent", price: 320, rarity: "rare", tags: [] },
  { id: "t-night-owl", name: "Night Owl", price: 300, rarity: "common", tags: [] },
  { id: "t-wave-rider", name: "Wave Rider", price: 300, rarity: "common", tags: [] },
  { id: "t-speedrunner", name: "Speedrunner", price: 300, rarity: "common", tags: [] },
  { id: "t-gamer", name: "Certified Gamer", price: 300, rarity: "common", tags: [] },
  { id: "t-binge", name: "Binge Watcher", price: 290, rarity: "common", tags: [] },
  { id: "t-bookworm", name: "Manga Bookworm", price: 290, rarity: "common", tags: [] },
  { id: "t-dj", name: "Aux Cord Holder", price: 280, rarity: "common", tags: [] },
  { id: "t-touch-grass", name: "Has Never Touched Grass", price: 260, rarity: "common", tags: [] },
  { id: "t-npc", name: "Just An NPC", price: 250, rarity: "common", tags: [] },
];

export const SHOP_ITEMS = [
  ...DECORATIONS.map((item) => ({ ...item, kind: "decoration" })),
  ...TITLES.map((item) => ({ ...item, kind: "title" })),
];

export const SHOP_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));

// how coins come in
export const ECONOMY = {
  startingCoins: 150,
  dailyBase: 100,
  dailyStreakBonus: 20,
  dailyStreakMax: 7,
  perActiveMinute: 1,
  activeDailyCap: 300,
  perChatMessage: 2,
  chatDailyCap: 60,
};

export const RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];

export function decorationUrl(item) {
  return `/assets/decor/${encodeURIComponent(item.file)}`;
}

/** the first frame as a png, for lists where 30 animated gifs would melt a chromebook */
export function decorationStill(item) {
  return `/assets/decor/${encodeURIComponent(item.file.replace(/\.gif$/, ".png"))}`;
}
