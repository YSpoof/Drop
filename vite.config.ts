import { relative, sep } from "node:path";

import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
import { svelteKitWebSocket } from "vite-plugin-sveltekit-ws";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // defaults to rune mode for the project, execept for `node_modules`. Can be removed in svelte 6.
        runes: ({ filename }) => {
          const relativePath = relative(import.meta.dirname, filename);
          const pathSegments = relativePath.toLowerCase().split(sep);
          const isExternalLibrary = pathSegments.includes("node_modules");

          return isExternalLibrary ? undefined : true;
        },
        experimental: {
          async: true,
        },
        modernAst: true,
      },
      adapter: adapter({
        precompress: false,
      }),
      version: {
        pollInterval: 1000 * 30, // 30 seconds
      },
    }),
    Icons({ compiler: "svelte" }),
    svelteKitWebSocket({
      handlerPath:  "./src/lib/server/signaling/handler.ts",
      exportName: "handleSignalingConnection",
    }),
  ],
  build: {
    target: "esnext",
    reportCompressedSize: false,
  },
  server: {
    port: 4321,
    allowedHosts: ["dev.lzart.com.br"],
    forwardConsole: true,
    watch: {
      ignored: ["**/tests/**", "**/fixtures/**", "**/playwright-report/**"],
    },
  },
});
