import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  version: pkg.version,
  dev: process.argv.includes("--dev") || process.env.NODE_ENV === "development",
  port: intEnv("PORT", 8080),
  // railway wants 0.0.0.0, your laptop is fine with it too
  host: process.env.HOST || "0.0.0.0",
  // railway mounts volumes wherever you tell it to and then politely tells us where
  dataDir: path.resolve(
    process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, "data"),
  ),
  trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === "true" : true,
  tmdbKey: process.env.TMDB_API_KEY || "ebbc810d0c9a9a4a13a264f96897036e",
  adminUsers: (process.env.ADMIN_USERS || "yaanscoat,beery-tomato")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean),
  serverCountry: process.env.SERVER_COUNTRY || "",
  serverRegion: process.env.SERVER_REGION || "",
  railwayRegion: process.env.RAILWAY_REPLICA_REGION || "",
  onRailway,
  discord: "https://discord.gg/dZPVgBu3AS",
};

export const paths = {
  dist: path.join(ROOT, "dist"),
  src: path.join(ROOT, "src"),
  assets: path.join(ROOT, "assets"),
  modules: path.join(ROOT, "node_modules"),
};

fs.mkdirSync(config.dataDir, { recursive: true });
