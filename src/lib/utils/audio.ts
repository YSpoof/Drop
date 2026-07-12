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
    for (const [name, url] of Object.entries(SFX) as [SfxName, string][]) {
      const audio = new Audio(url);
      audio.preload = "auto";
      this.#cache.set(name, audio);
    }
  }

  play(name: SfxName) {
    const audio = this.#cache.get(name);
    if (!audio) return;

    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }

  warning() {
    this.play("warning");
  }

  success() {
    this.play("success");
  }

  info() {
    this.play("info");
  }

  error() {
    this.play("error");
  }
}

export const sfx = new SfxPlayer();
