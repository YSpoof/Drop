import { localForage } from "#lib/utils/localForage.js";

const tutorialViewed = await localForage.getItem<boolean>("tutorialViewed");
const initialDevMode = (await localForage.getItem<boolean>("devMode")) ?? false;

class UiStore {
  unsupportedBrowserModalOpen = $state(false);
  codeJoinOpen = $state(false);
  tutorialModalOpen = $state(!tutorialViewed);
  infoModalOpen = $state(false);
  statsModalOpen = $state(false);
  settingsModalOpen = $state(false);
  shareNotifyModalOpen = $state(false);
  shareNotifyDenied = $state(false);
  devMode = $state(initialDevMode);
  installPrompt = $state<BeforeInstallPromptEvent | null>(null);

  setDevMode(value: boolean) {
    this.devMode = value;
    localForage.setItem("devMode", value);
  }

  setInstallPrompt(prompt: BeforeInstallPromptEvent) {
    this.installPrompt = prompt;
  }

  clearInstallPrompt() {
    this.installPrompt = null;
  }
}

export const uiStore = new UiStore();
