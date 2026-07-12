import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

import { wsServer } from "./src/plugins/wsServer.ts";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), Icons({ compiler: "svelte" }), wsServer()],
  build: {
    target: "esnext",
    reportCompressedSize: false,
  },
  server: {
    port: 4321,
    allowedHosts: ["dev.lzart.com.br"],
  },
});
