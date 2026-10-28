// parsing youtube's 2.5mb player script to find its signature functions costs
// ~270mb, and node rarely hands that memory back. so a throwaway thread does
// the parse, youtubei.js writes the small result to the disk cache, and the
// thread exits, taking all of that memory with it. the main server then loads
// the cached result for a few mb.
import { workerData } from "node:worker_threads";
import { Innertube, Log, UniversalCache } from "youtubei.js";
import { innertubeFetch, youtubeProxied } from "../lib/youtube-route.js";

Log.setLevel(Log.Level.NONE);
await Innertube.create({
  retrieve_player: true,
  cache: new UniversalCache(true, workerData.cacheDir),
  ...(youtubeProxied ? { fetch: innertubeFetch } : {}),
});
