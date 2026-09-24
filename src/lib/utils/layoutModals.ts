import { lazy } from "svelte-comp-lazyloader";

import { uiStore } from "#lib/stores/uiStore.svelte.js";

export const layoutModals = [
  {
    key: "setupWizard",
    isOpen: () => uiStore.setupWizardOpen,
    Component: lazy(() => import("#lib/components/modals/SetupWizard.svelte")),
  },
  {
    key: "infoModal",
    isOpen: () => uiStore.infoModalOpen,
    Component: lazy(() => import("#lib/components/modals/InfoModal.svelte")),
  },
  {
    key: "statsModal",
    isOpen: () => uiStore.statsModalOpen,
    Component: lazy(() => import("#lib/components/modals/StatsModal.svelte")),
  },
  {
    key: "settingsModal",
    isOpen: () => uiStore.settingsModalOpen,
    Component: lazy(() => import("#lib/components/modals/SettingsModal.svelte")),
  },
];
