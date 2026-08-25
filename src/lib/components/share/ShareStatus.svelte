<script lang="ts">
  import { onDestroy } from "svelte";
  import CheckCircleIcon from "~icons/mdi/check-circle";
  import ContentCopyIcon from "~icons/mdi/content-copy";
  import LogoutIcon from "~icons/mdi/logout";
  import RadioTowerIcon from "~icons/mdi/radio-tower";

  import { feedback } from "#lib/utils/feedback.js";

  type CodeJoinPhase = "waiting" | "connecting" | "connected";

  interface Props {
    isHost: boolean;
    connected: boolean;
    viaLan: boolean;
    code: string | undefined;
    link: string | undefined;
    peerName?: string | null;
    codeJoinPhase?: CodeJoinPhase;
    onLeave: () => void;
    onDisconnect: () => void;
  }

  let {
    isHost,
    connected,
    viaLan,
    code,
    link,
    peerName = null,
    codeJoinPhase = "waiting",
    onLeave,
    onDisconnect,
  }: Props = $props();

  let copied = $state<"link" | "code" | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const title = $derived.by(() => {
    if (connected) return "Pronto para transferir";
    if (isHost) return "Aguardando a conexão";
    if (codeJoinPhase === "connecting") return "Conectando";
    return "Esperando pelo host";
  });

  const subtitle = $derived.by(() => {
    if (connected) return "Conectado";
    if (isHost) return "Esperando pelo outro dispositivo...";
    if (codeJoinPhase === "connecting") return "Efetuando a conexão...";
    return "Esperando pelo host...";
  });

  onDestroy(() => {
    clearTimeout(copiedTimer);
  });

  function handleDisconnect() {
    feedback.medium();
    onDisconnect();
  }

  function handleLeave() {
    feedback.medium();
    onLeave();
  }

  async function copy(text: string | undefined, kind: "link" | "code") {
    if (!text) return;
    feedback.light();
    try {
      await navigator.clipboard.writeText(text);
      copied = kind;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copied = null;
      }, 2500);
    } catch {
      // ignore
    }
  }
</script>

<section
  class="card bg-base-100 dark:bg-base-300 min-w-0 overflow-hidden px-4 py-3.5 shadow-sm sm:px-5">
  <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    <div class="flex min-w-0 items-center gap-3">
      <div
        class="bg-primary text-primary-content grid size-10 shrink-0 place-items-center rounded-full">
        <RadioTowerIcon class="text-xl" />
      </div>
      <div class="min-w-0">
        <h2 class="text-base font-semibold lg:truncate">{title}</h2>
        <p class="text-base-content/60 text-sm text-pretty lg:truncate">
          {subtitle}
        </p>
      </div>
    </div>

    <div
      class="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-nowrap lg:items-center lg:justify-end lg:gap-3">
      {#if connected}
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="status status-success status-sm"
            aria-label="conectado"></span>
          {#if peerName}
            <span class="truncate font-medium">{peerName}</span>
          {/if}
          {#if viaLan}
            <span class="badge badge-success badge-sm">LAN</span>
          {/if}
        </div>
        <div
          class="bg-base-content/25 hidden h-6 w-px lg:block"
          aria-hidden="true">
        </div>
        <button
          type="button"
          class="btn btn-outline btn-error lg:btn-sm w-full gap-2 lg:w-auto"
          onclick={handleDisconnect}>
          Desconectar
          <LogoutIcon class="text-base" />
        </button>
      {:else if isHost}
        {#if code}
          <p class="font-mono text-2xl tracking-widest tabular-nums max-lg:text-center lg:text-xl">
            {code}
          </p>
        {:else}
          <p class="text-base-content/60 skeleton skeleton-text text-sm max-lg:text-center">
            Gerando código…
          </p>
        {/if}
        <div class="grid w-full grid-cols-2 gap-2 lg:contents">
          <button
            type="button"
            class={[
              "btn lg:btn-sm w-full gap-2 lg:w-auto",
              copied === "link" ? "btn-success" : "btn-primary",
            ]}
            disabled={!link || copied === "link"}
            onclick={() => copy(link, "link")}>
            {#if copied === "link"}
              <CheckCircleIcon class="text-base" />
            {:else}
              <ContentCopyIcon class="text-base" />
            {/if}
            Copiar link
          </button>
          <button
            type="button"
            class={[
              "btn lg:btn-sm w-full gap-2 lg:w-auto",
              copied === "code" ? "btn-success" : "btn-primary",
            ]}
            disabled={!code || copied === "code"}
            onclick={() => copy(code, "code")}>
            {#if copied === "code"}
              <CheckCircleIcon class="text-base" />
            {:else}
              <ContentCopyIcon class="text-base" />
            {/if}
            Copiar código
          </button>
        </div>
        <div
          class="bg-base-content/25 hidden h-6 w-px lg:block"
          aria-hidden="true">
        </div>
        <button
          type="button"
          class="btn btn-outline btn-error lg:btn-sm w-full gap-2 lg:w-auto"
          onclick={handleLeave}>
          Sair
          <LogoutIcon class="text-base" />
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-outline btn-error lg:btn-sm w-full gap-2 lg:w-auto"
          onclick={handleLeave}>
          Sair
          <LogoutIcon class="text-base" />
        </button>
      {/if}
    </div>
  </div>
</section>
