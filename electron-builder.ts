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
    target: ["nsis"],
    signExecutable: false,
  },
  nsis: {
    oneClick: false,
    // installerIcon: "static/images/pwa/512.png",
    // uninstallerIcon: "static/images/pwa/512.png",
    uninstallDisplayName: "Desinstalar Drop",
    license: "LICENSE",
    language: "1046",
    warningsAsErrors: false,
    allowToChangeInstallationDirectory: true,
  }
} satisfies Configuration;
