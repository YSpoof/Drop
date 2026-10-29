class InstallPromptStore {
  current = $state<BeforeInstallPromptEvent | null>(null);

  constructor() {
    if (typeof window === "undefined") return;

    if (window.__dropInstallPrompt) this.current = window.__dropInstallPrompt;

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      const prompt = e as BeforeInstallPromptEvent;
      window.__dropInstallPrompt = prompt;
      this.current = prompt;
    });

    window.addEventListener("appinstalled", () => {
      this.clear();
    });
  }

  clear() {
    this.current = null;
    if (typeof window !== "undefined") window.__dropInstallPrompt = undefined;
  }
}

export const installPromptStore = new InstallPromptStore();
