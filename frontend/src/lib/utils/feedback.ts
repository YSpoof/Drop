const supported = typeof navigator !== "undefined" && "vibrate" in navigator;

const SFX = {
  success: "/sfx/success.mp3",
  warning: "/sfx/warning.mp3",
  info: "/sfx/info.mp3",
  error: "/sfx/error.mp3",
} as const;

type SfxName = keyof typeof SFX;

class SfxPlayer {
  #cache = new Map<SfxName, HTMLAudioElement>();

  constructor() {
    if (typeof Audio !== "undefined") {
      for (const [name, url] of Object.entries(SFX) as [SfxName, string][]) {
        const audio = new Audio(url);
        audio.preload = "auto";
        this.#cache.set(name, audio);
      }
    }
  }

  play(name: SfxName) {
    const audio = this.#cache.get(name);
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }
}

const sfx = new SfxPlayer();

export const feedback = {
  success() {
    sfx.play("success");
    if (supported) navigator.vibrate([35, 60, 45]);
  },
  info() {
    sfx.play("info");
    if (supported) navigator.vibrate(40);
  },
  warning() {
    sfx.play("warning");
    if (supported) navigator.vibrate([45, 100, 45]);
  },
  error() {
    sfx.play("error");
    if (supported) navigator.vibrate([45, 40, 45, 40, 45]);
  },
  light() {
    if (supported) navigator.vibrate(20);
  },
  medium() {
    if (supported) navigator.vibrate(30);
  },
  heavy() {
    if (supported) navigator.vibrate(40);
  },
};
