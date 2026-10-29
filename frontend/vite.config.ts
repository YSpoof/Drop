import { relative, sep } from "node:path";

import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
// vite-plugin-sveltekit-ws removed: signaling is handled by the Go backend.

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
        fallback: "index.html",
      }),
      version: {
        pollInterval: 1000 * 30, // 30 seconds
      },
      csrf: {
        trustedOrigins: ["*"],
      },
    }),
    Icons({ compiler: "svelte" }),
    // signaling handled by Go backend; no SvelteKit WebSocket plugin needed.
  ],
  build: {
    target: "esnext",
    reportCompressedSize: false,
  },
  server: {
    port: 4321,
    strictPort: true,
    proxy: {
      "/ws": {
        target: "http://localhost:8080",
        ws: true,
      },
    },
    allowedHosts: ["dev.lzart.com.br"],
    forwardConsole: true,
    watch: {
      ignored: [
        "**/tests/**",
        "**/fixtures/**",
        "**/playwright-report/**",
        "**/dist/**",
        "**/native/**",
        "**/bin/**",
      ],
    },
  },
});
