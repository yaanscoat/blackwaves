// the shop catalog. shared by the server (which charges you) and the client
// (which shows you what you can't afford yet).
//
// pricing rule: normal stuff sits around 300 coins. anything with a cat,
// fox, deer or anime in it starts above 1,000, and the fox tail is the most
// expensive thing in the building. no, there is no discount code.
//
// the original gif decorations sit behind your avatar; the newer animated
// png ones (front: true) are drawn on top of it.

export const DECORATIONS = [
  { id: "foxtail", name: "Fox Tail", price: 9999, rarity: "mythic", file: "foxtail.png", still: "foxtail.still.png", front: true, tags: ["fox"] },
  { id: "catearsblack", name: "Black Cat Ears", price: 2600, rarity: "legendary", file: "catearsblack.png", still: "catearsblack.still.png", front: true, tags: ["cat"] },
  { id: "dragon", name: "Dragon", price: 480, rarity: "rare", file: "dragon.png", still: "dragon.still.png", front: true, tags: [] },
  { id: "lonewolf", name: "Lone Wolf", price: 460, rarity: "rare", file: "lonewolf.png", still: "lonewolf.still.png", front: true, tags: [] },
  { id: "angelwings", name: "Angel Wings", price: 450, rarity: "rare", file: "angelwings.png", still: "angelwings.still.png", front: true, tags: [] },
  { id: "ritualcircle", name: "Ritual Circle", price: 440, rarity: "rare", file: "ritualcircle.png", still: "ritualcircle.still.png", front: true, tags: [] },
  { id: "spacetravel", name: "Space Travel", price: 420, rarity: "rare", file: "spacetravel.png", still: "spacetravel.still.png", front: true, tags: [] },
  { id: "aurora", name: "Aurora", price: 410, rarity: "rare", file: "aurora.png", still: "aurora.still.png", front: true, tags: [] },
  { id: "hallelujamountains", name: "Hallelujah Mountains", price: 400, rarity: "rare", file: "hallelujamountains.png", still: "hallelujamountains.still.png", front: true, tags: [] },
  { id: "whiteroses", name: "White Roses", price: 390, rarity: "rare", file: "whiteroses.png", still: "whiteroses.still.png", front: true, tags: [] },
  { id: "japanesemaple", name: "Japanese Maple", price: 380, rarity: "rare", file: "japanesemaple.png", still: "japanesemaple.still.png", front: true, tags: [] },
  { id: "sakuraink", name: "Sakura Ink", price: 370, rarity: "rare", file: "sakuraink.png", still: "sakuraink.still.png", front: true, tags: [] },
  { id: "purplesparkles", name: "Purple Sparkles", price: 360, rarity: "rare", file: "purplesparkles.png", still: "purplesparkles.still.png", front: true, tags: [] },
  { id: "purplering", name: "Purple Ring", price: 350, rarity: "rare", file: "purplering.png", still: "purplering.still.png", front: true, tags: [] },
  { id: "cometsdusk", name: "Comets at Dusk", price: 350, rarity: "rare", file: "cometsdusk.png", still: "cometsdusk.still.png", front: true, tags: [] },
  { id: "deepseadreams", name: "Deep Sea Dreams", price: 340, rarity: "rare", file: "deepseadreams.png", still: "deepseadreams.still.png", front: true, tags: [] },
  { id: "orbital", name: "Orbital", price: 330, rarity: "rare", file: "orbital.png", still: "orbital.still.png", front: true, tags: [] },
  { id: "airforce", name: "Air Force", price: 320, rarity: "rare", file: "airforce.png", still: "airforce.still.png", front: true, tags: [] },
  { id: "flames", name: "Flames", price: 320, rarity: "rare", file: "flames.png", still: "flames.still.png", front: true, tags: [] },
  { id: "witchinghour2", name: "Witching Hour II", price: 310, rarity: "rare", file: "witchinghour2.png", still: "witchinghour2.still.png", front: true, tags: [] },
  { id: "moon", name: "Moon", price: 300, rarity: "common", file: "moon.png", still: "moon.still.png", front: true, tags: [] },
  { id: "cloudnine", name: "Cloud Nine", price: 300, rarity: "common", file: "cloudnine.png", still: "cloudnine.still.png", front: true, tags: [] },
  { id: "swirl", name: "Swirl", price: 300, rarity: "common", file: "swirl.png", still: "swirl.still.png", front: true, tags: [] },
  { id: "sweetdreams", name: "Sweet Dreams", price: 300, rarity: "common", file: "sweetdreams.png", still: "sweetdreams.still.png", front: true, tags: [] },
  { id: "fallfoliage", name: "Fall Foliage", price: 290, rarity: "common", file: "fallfoliage.png", still: "fallfoliage.still.png", front: true, tags: [] },
  { id: "leafloaf", name: "Leaf Loaf", price: 290, rarity: "common", file: "leafloaf.png", still: "leafloaf.still.png", front: true, tags: [] },
  { id: "witchinghour", name: "Witching Hour", price: 280, rarity: "common", file: "witchinghour.png", still: "witchinghour.still.png", front: true, tags: [] },
  { id: "petals", name: "Petals", price: 280, rarity: "common", file: "petals.png", still: "petals.still.png", front: true, tags: [] },
  { id: "chomp", name: "Chomp", price: 270, rarity: "common", file: "chomp.png", still: "chomp.still.png", front: true, tags: [] },
  { id: "spirits", name: "Spirits", price: 260, rarity: "common", file: "spirits.png", still: "spirits.still.png", front: true, tags: [] },
  { id: "surprised", name: "Surprised", price: 250, rarity: "common", file: "surprised.png", still: "surprised.still.png", front: true, tags: [] },
  { id: "sweatdrops", name: "Sweat Drops", price: 250, rarity: "common", file: "sweatdrops.png", still: "sweatdrops.still.png", front: true, tags: [] },
  { id: "skillissue", name: "Skill Issue", price: 240, rarity: "common", file: "skillissue.png", still: "skillissue.still.png", front: true, tags: [] },
  { id: "loading", name: "Loading...", price: 200, rarity: "common", file: "loading.png", still: "loading.still.png", front: true, tags: [] },
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
  return `/assets/decor/${encodeURIComponent(item.still || item.file.replace(/\.gif$/, ".png"))}`;
}
