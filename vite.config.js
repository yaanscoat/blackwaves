import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  root: "src",
  publicDir: "../public",
  plugins: [preact()],
  define: {
    __BW_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    fs: { allow: [root] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // hashed files land in /_bw/ so they never collide with a game asking for /assets/...
    assetsDir: "_bw",
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/hls.js")) return "hls";
          if (id.includes("node_modules/preact") || id.includes("node_modules/@preact")) return "preact";
        },
      },
    },
  },
});
