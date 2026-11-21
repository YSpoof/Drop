import { localForage } from "#lib/utils/localForage.js";

const setupWizardViewed = await localForage.getItem<boolean>("setupWizardViewed");
const initialDevMode = (await localForage.getItem<boolean>("devMode")) ?? false;

class UiStore {
  codeJoinOpen = $state(false);
  setupWizardOpen = $state(!setupWizardViewed);
  infoModalOpen = $state(false);
  statsModalOpen = $state(false);
  settingsModalOpen = $state(false);
  shareNotifyModalOpen = $state(false);
  installModalOpen = $state(false);
  shareNotifyDenied = $state(false);
  devMode = $state(initialDevMode);

  anyModalOpen = $derived(
    this.codeJoinOpen ||
      this.setupWizardOpen ||
      this.infoModalOpen ||
      this.statsModalOpen ||
      this.settingsModalOpen ||
      this.shareNotifyModalOpen ||
      this.installModalOpen,
  );

  setDevMode(value: boolean) {
    this.devMode = value;
    localForage.setItem("devMode", value);
  }
}

export const uiStore = new UiStore();
