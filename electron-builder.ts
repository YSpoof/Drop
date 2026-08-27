import type { Configuration } from "electron-builder";

export default {
  appId: "br.com.lzart.drop",
  productName: "Drop",
  compression: "normal",
  electronLanguages: ["pt-BR"],
  icon: "static/images/pwa/512.png",
  directories: { output: "release" },
  files: ["native/out/**"],
  linux: {
    target: ["AppImage"],
    category: "Network",
  },
  publish: null,
  win: {
    target: ["portable"],
    signExecutable: false,
  },
} satisfies Configuration;
