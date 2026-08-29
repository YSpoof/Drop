import type { Component } from "svelte";

import { uiStore } from "#lib/stores/uiStore.svelte.js";

type LayoutModal = {
  key: string;
  isOpen: () => boolean;
  load: () => Promise<{ default: Component }>;
};

export const layoutModals: LayoutModal[] = [
  {
    key: "setupWizard",
    isOpen: () => uiStore.setupWizardOpen,
    load: () => import("#lib/components/modals/SetupWizard.svelte"),
  },
  {
    key: "infoModal",
    isOpen: () => uiStore.infoModalOpen,
    load: () => import("#lib/components/modals/InfoModal.svelte"),
  },
  {
    key: "statsModal",
    isOpen: () => uiStore.statsModalOpen,
    load: () => import("#lib/components/modals/StatsModal.svelte"),
  },
  {
    key: "settingsModal",
    isOpen: () => uiStore.settingsModalOpen,
    load: () => import("#lib/components/modals/SettingsModal.svelte"),
  },
];
