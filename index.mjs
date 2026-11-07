import express from "express";
import compression from "compression";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";

const publicPath = path.join(process.cwd(), "public");
const port = parseInt(process.env.PORT || "8000");

logging.set_level(logging.ERROR);

const app = express();

app.use(compression());
app.use("/scram/", express.static(scramjetPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use(express.static(publicPath));

app.get("/", (req, res) => res.sendFile(path.join(publicPath, "index.html")));
app.get("/gs", (req, res) => res.sendFile(path.join(publicPath, "gs.html")));
app.get("/as", (req, res) => res.sendFile(path.join(publicPath, "as.html")));
app.use((req, res) => res.status(404).sendFile(path.join(publicPath, "404.html")));

const server = createServer(app);
const pingServer = new WebSocketServer({ noServer: true });

pingServer.on("connection", (ws) => {
  const timer = setInterval(() => {
    ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
  }, 5000);

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === "pong" && data.timestamp) {
        ws.send(JSON.stringify({ type: "latency", latency: Date.now() - data.timestamp }));
      }
    } catch {}
  });

  ws.on("close", () => clearInterval(timer));
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/w/ping") {
    pingServer.handleUpgrade(req, socket, head, (ws) => pingServer.emit("connection", ws, req));
  } else if (req.url.startsWith("/w/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

server.listen(port, () => {
  console.log(`BlackWaves is running at http://localhost:${port}`);
});

function shutdown() {
  console.log("Shutting down BlackWaves...");
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
