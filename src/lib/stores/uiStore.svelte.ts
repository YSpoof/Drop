import { localForage } from "$lib/utils/localForage";
import { feedback } from "$lib/utils/feedback";

const tutorialViewed = await localForage.getItem<boolean>("tutorialViewed");
const initialDevMode = (await localForage.getItem<boolean>("devMode")) ?? false;

class UiStore {
  connectionModalOpen = $state(false);
  unsupportedBrowserModalOpen = $state(false);
  roomJoinOpen = $state(false);
  tutorialModalOpen = $state(!tutorialViewed);
  infoModalOpen = $state(false);
  statsModalOpen = $state(false);
  settingsModalOpen = $state(false);
  shareModalOpen = $state(false);
  shareNotifyModalOpen = $state(false);
  shareNotifyDenied = $state(false);
  devMode = $state(initialDevMode);
  installPrompt = $state<BeforeInstallPromptEvent | null>(null);

  handleShareLinkClick(inRoom: boolean) {
    feedback.light();
    if (inRoom) {
      this.shareModalOpen = true;
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      this.shareModalOpen = true;
      return;
    }
    this.shareNotifyDenied = false;
    this.shareNotifyModalOpen = true;
  }

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
