// runs youtube's botguard challenge in its own thread and mints "proof of
// origin" tokens. youtube only serves the first megabyte of a song without one.
// botguard expects a browser, so this thread gets a fake one (jsdom) that never
// leaks into the main server.
import { parentPort } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, GOOG_API_KEY, USER_AGENT } from "bgutils-js/utils";
import { Innertube, Log } from "youtubei.js";

Log.setLevel(Log.Level.NONE);
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
  url: "https://www.youtube.com/",
  referrer: "https://www.youtube.com/",
  userAgent: USER_AGENT,
  virtualConsole: undefined,
});
Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, origin: dom.window.origin });
if (!Reflect.has(globalThis, "navigator")) Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator });
// botguard pokes canvas; jsdom complains loudly about it. we don't need the complaint.
dom.window.HTMLCanvasElement.prototype.getContext = () => null;

let minter = null;
let visitorData = "";
let expires = 0;
let starting = null;

async function start() {
  const bootstrap = await Innertube.create({ retrieve_player: false });
  visitorData = bootstrap.session.context.client.visitorData;
  const challenge = await bootstrap.getAttestationChallenge("ENGAGEMENT_TYPE_UNBOUND");
  if (!challenge.bg_challenge) throw new Error("no botguard challenge");
  const interpreterUrl = challenge.bg_challenge.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
  const script = await (await fetch(`https:${interpreterUrl}`)).text();
  new Function(script)();
  const botguard = await BotGuardClient.create({
    program: challenge.bg_challenge.program,
    globalName: challenge.bg_challenge.global_name,
    globalObject: globalThis,
  });
  const webPoSignalOutput = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const response = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: { "content-type": "application/json+protobuf", "x-goog-api-key": GOOG_API_KEY, "x-user-agent": "grpc-web-javascript/0.1", "user-agent": USER_AGENT },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  const data = await response.json();
  if (typeof data[0] !== "string") throw new Error("no integrity token");
  minter = await WebPoMinter.create({ integrityToken: data[0] }, webPoSignalOutput);
  // refresh a bit before youtube says the token dies (usually 12h)
  expires = Date.now() + Math.max(10 * 60, Number(data[1]) || 6 * 60 * 60) * 800;
}

async function ready() {
  if (minter && Date.now() < expires) return;
  starting ||= start().finally(() => (starting = null));
  await starting;
}

parentPort.on("message", async ({ id, binding }) => {
  try {
    await ready();
    const token = await minter.mintAsWebsafeString(binding || visitorData);
    parentPort.postMessage({ id, token, visitorData, expires });
  } catch (error) {
    minter = null;
    parentPort.postMessage({ id, error: error.message || String(error) });
  }
});
