import { uiStore } from "$lib/stores/uiStore.svelte";
import type { Component } from "svelte";

type LayoutModal = {
  key: string;
  isOpen: () => boolean;
  load: () => Promise<{ default: Component }>;
};

export const layoutModals: LayoutModal[] = [
  {
    key: "tutorialModal",
    isOpen: () => uiStore.tutorialModalOpen,
    load: () => import("$lib/components/modals/TutorialModal.svelte"),
  },
  {
    key: "infoModal",
    isOpen: () => uiStore.infoModalOpen,
    load: () => import("$lib/components/modals/InfoModal.svelte"),
  },
  {
    key: "statsModal",
    isOpen: () => uiStore.statsModalOpen,
    load: () => import("$lib/components/modals/StatsModal.svelte"),
  },
  {
    key: "settingsModal",
    isOpen: () => uiStore.settingsModalOpen,
    load: () => import("$lib/components/modals/SettingsModal.svelte"),
  },
];
