/// <reference types="unplugin-icons/types/svelte" />

import type { EventHandler } from "svelte/elements";

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{
      outcome: "accepted" | "dismissed";
      platform: string;
    }>;

    prompt(): Promise<UserChoice>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }

  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    __dropInstallPrompt?: BeforeInstallPromptEvent;
    electronRPC?: {
      isDesktop: boolean;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      getPathForFile: (file: File) => string;
    };
  }
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};

declare module "svelte/elements" {
  export interface SvelteWindowAttributes {
    onappinstalled?: EventHandler<Event, Window> | undefined | null;
  }
}
