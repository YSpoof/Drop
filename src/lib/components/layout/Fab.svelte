<script lang="ts">
  import { page } from "$app/state";
  import { appState } from "$lib/stores/appState.svelte";
  import ChartBarIcon from "~icons/mdi/chart-bar";
  import CogIcon from "~icons/mdi/cog";
  import InfoIcon from "~icons/mdi/information-outline";
  import LinkIcon from "~icons/mdi/link";
  import LinkOffIcon from "~icons/mdi/link-off";
  import SchoolIcon from "~icons/mdi/school-outline";

  const inRoom = $derived(!!page.url.searchParams.get("room"));

  const labelClass =
    "bg-neutral text-neutral-content rounded-full px-3 py-1 text-sm font-semibold shadow-md";
</script>

<div class="fab">
  <div
    tabindex="0"
    role="button"
    class="btn btn-lg btn-circle btn-primary">
    <CogIcon class="text-2xl" />
  </div>

  <div class="fab-close">
    <span class={labelClass}>Fechar</span>
    <span class="btn btn-circle btn-lg btn-error">✕</span>
  </div>

  <div>
    <span class={labelClass}>{inRoom ? "Gerenciar conexão" : "Conectar remotamente"}</span>
    <button
      class="btn btn-lg btn-circle {inRoom ? 'btn-success' : 'btn-primary'}"
      onclick={() => appState.handleShareLinkClick(inRoom)}>
      {#if inRoom}
        <LinkOffIcon class="text-xl" />
      {:else}
        <LinkIcon class="text-xl" />
      {/if}
    </button>
  </div>
  <div>
    <span class={labelClass}>Estatísticas</span>
    <button
      class="btn btn-lg btn-circle btn-primary"
      onclick={() => (appState.statsModalOpen = true)}>
      <ChartBarIcon class="text-xl" />
    </button>
  </div>
  <div>
    <span class={labelClass}>Configurações</span>
    <button
      class="btn btn-lg btn-circle btn-primary"
      onclick={() => (appState.settingsModalOpen = true)}>
      <CogIcon class="text-xl" />
    </button>
  </div>
  <div>
    <span class={labelClass}>Rever tutorial</span>
    <button
      class="btn btn-lg btn-circle btn-info"
      onclick={() => (appState.tutorialModalOpen = true)}>
      <SchoolIcon class="text-xl" />
    </button>
  </div>
  <div>
    <span class={labelClass}>Sobre</span>
    <button
      class="btn btn-lg btn-circle btn-info"
      onclick={() => (appState.infoModalOpen = true)}>
      <InfoIcon class="text-xl" />
    </button>
  </div>
</div>
