<script lang="ts">
  import ChartBarIcon from "~icons/mdi/chart-bar";
  import CogIcon from "~icons/mdi/cog";
  import InfoIcon from "~icons/mdi/information-outline";
  import WizardIcon from "~icons/mdi/wizard-hat";

  import { uiStore } from "#lib/stores/uiStore.svelte.js";

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
    <span class={labelClass}>Estatísticas</span>
    <button
      class="btn btn-lg btn-circle btn-primary"
      onclick={() => (uiStore.statsModalOpen = true)}>
      <ChartBarIcon class="text-xl" />
    </button>
  </div>
  <div>
    <span class={labelClass}>Configurações</span>
    <button
      class="btn btn-lg btn-circle btn-primary"
      onclick={() => (uiStore.settingsModalOpen = true)}>
      <CogIcon class="text-xl" />
    </button>
  </div>
  <div>
    <span class={labelClass}>Abrir setup</span>
    <button
      class="btn btn-lg btn-circle btn-info"
      onclick={() => (uiStore.setupWizardOpen = true)}>
      <WizardIcon class="text-xl" />
    </button>
  </div>
  <div>
    <span class={labelClass}>Sobre</span>
    <button
      class="btn btn-lg btn-circle btn-info"
      onclick={() => (uiStore.infoModalOpen = true)}>
      <InfoIcon class="text-xl" />
    </button>
  </div>
</div>
