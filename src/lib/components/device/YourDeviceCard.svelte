<script lang="ts">
  interface Props {
    displayName: string;
    handleDisplayNameBlur: () => void;
  }
  let { displayName = $bindable(), handleDisplayNameBlur }: Props = $props();
</script>

<section class="card bg-base-100 dark:bg-base-300 min-w-0 flex-1 overflow-hidden shadow-sm">
  <div class="card-body gap-3">
    <h2 class="text-lg font-semibold">Seu dispositivo</h2>
    <label class="floating-label">
      <input
        type="text"
        placeholder="Nome de exibição"
        class="input w-full"
        bind:value={displayName}
        onblur={handleDisplayNameBlur} />
      <span>Nome de exibição</span>
    </label>
  </div>
</section>
