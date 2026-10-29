<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    duration: number;
    progressClass: string;
    onComplete: () => void;
  }

  let { duration, progressClass, onComplete }: Props = $props();
  let progress = $state(1);

  onMount(() => {
    const toastDuration = Math.max(duration, 1);

    let animationFrameId: number | null = null;
    let elapsed = 0;
    let lastFrameTime = performance.now();
    let finished = false;

    const tick = (now: number) => {
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      elapsed += delta;

      progress = Math.max(0, 1 - elapsed / toastDuration);

      if (progress <= 0 && !finished) {
        finished = true;
        onComplete();
        return;
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      if (typeof animationFrameId === "number") {
        cancelAnimationFrame(animationFrameId);
      }
    };
  });
</script>

<div
  class="pointer-events-none absolute bottom-0 left-0 h-1 w-full bg-black/15"
  aria-hidden="true">
  <div
    class={`toast-progress-fill h-full ${progressClass}`}
    style={`width:${progress * 100}%;`}>
  </div>
</div>

<div
  class="sr-only"
  role="progressbar"
  aria-label="Tempo restante da notificação"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={progress * 100}>
</div>
