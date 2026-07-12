import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { build, type Plugin } from "vite";
import { WebSocketServer } from "ws";

import { handleSignalingConnection } from "../lib/server/signaling/handler.ts";

const root = resolve(import.meta.dirname, "../..");
const outDir = resolve(root, "build");
const virtualEntryId = "virtual:ws-server-entry";

const serverEntry = `
import process from "node:process";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { handler } from "./handler.js";
import { handleSignalingConnection } from "$lib/server/signaling/handler.ts";

const port = Number(process.env.PORT) || 3000;

const httpServer = createServer(handler);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const pathname = req.url?.split("?")[0];
  if (pathname !== "/ws") return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleSignalingConnection(ws, req);
  });
});

httpServer.listen(port, () => {
  console.log(\`Drop server listening on http://localhost:\${port}\`);
});
`;

function virtualEntryPlugin(): Plugin {
  return {
    name: "ws-server-entry",
    resolveId(id) {
      if (id === virtualEntryId) return `\0${virtualEntryId}`;
      if (id === "./handler.js") return { id: "./handler.js", external: true };
    },
    load(id) {
      if (id === `\0${virtualEntryId}`) return serverEntry;
    },
  };
}

async function buildServerBundle() {
  await build({
    configFile: false,
    resolve: {
      alias: {
        $lib: resolve(root, "src/lib"),
      },
    },
    plugins: [virtualEntryPlugin()],
    build: {
      emptyOutDir: false,
      outDir,
      target: "esnext",
      minify: false,
      write: true,
      rollupOptions: {
        input: virtualEntryId,
        output: {
          entryFileNames: "server.js",
          format: "es",
        },
        external: (id) => id === "ws" || id.startsWith("node:"),
      },
    },
    logLevel: "warn",
  });
}

export function wsServer(): Plugin {
  return {
    name: "ws-server",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on("upgrade", (req, socket, head) => {
        const pathname = req.url?.split("?")[0];
        if (pathname !== "/ws") return;
        wss.handleUpgrade(req, socket, head, (ws) => {
          handleSignalingConnection(ws, req);
        });
      });
    },
    closeBundle: {
      sequential: true,
      async handler() {
        if (!existsSync(resolve(outDir, "handler.js"))) return;
        await buildServerBundle();
      },
    },
  };
}
