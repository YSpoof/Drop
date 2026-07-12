import { relative, sep } from "node:path";

import adapter from "@sveltejs/adapter-node";

/** @type {import('@sveltejs/kit').Config} */
const config = {
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
  kit: {
    adapter: adapter({
      precompress: false,
    }),
    experimental: {
      remoteFunctions: true,
      handleRenderingErrors: true,
      forkPreloads: true,
    },
    router: {
      resolution: "client",
    },
    version: {
      pollInterval: 1000 * 30, // 30 seconds
    },
  },
};

export default config;
