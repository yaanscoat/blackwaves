const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
  files: {
    wasm: "/scram/scramjet.wasm.wasm",
    all: "/scram/scramjet.all.js",
    sync: "/scram/scramjet.sync.js"
  }
});

const proxyFrame = scramjet.createFrame(document.getElementById("cool-iframe"));
proxyFrame.frame.contentWindow.name = proxyFrame.frame.name;
const transport = localStorage.getItem("transport") === "epoxy" ? "epoxy" : "libcurl";
const wispUrl = localStorage.getItem("customWispUrl") || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/w/`;
const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

async function startProxy() {
  await scramjet.init();
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  await connection.setTransport(`/${transport}/index.mjs`, [{ wisp: wispUrl }]);
  console.log(`BlackWaves is ready using ${transport}.`);
}

const proxyReady = startProxy();

async function loadPage(url) {
  try {
    await proxyReady;
    proxyFrame.go(url);
  } catch (error) {
    console.error("BlackWaves could not start the proxy:", error);
    showToast("The proxy could not start. Try refreshing the page.", "error", "times-circle");
  }
}
