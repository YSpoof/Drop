<script lang="ts">
  import { goto } from "$app/navigation";
  import { updated } from "$app/state";
  import { inject } from "quick-di";
  import { onMount } from "svelte";
  import { lazy } from "svelte-comp-lazyloader";
  import LightningBoltIcon from "~icons/mdi/lightning-bolt";
  import NumericIcon from "~icons/mdi/numeric";

  import LazyModal from "#lib/components/ui/LazyModal.svelte";
  import { SHARE_CODE_DIGITS } from "#lib/consts.js";
  import { NotificationsPort } from "#lib/ports/notifications.js";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import {
    dismissDonationReminder,
    readVisitCount,
    recordAppVisit,
  } from "#lib/utils/donationReminder.js";
  import { feedback } from "#lib/utils/feedback.js";
  import { hasSharedRecords } from "#lib/utils/files/webShare.js";

  const DonationReminderModal = lazy(
    () => import("#lib/components/modals/DonationReminderModal.svelte"),
  );
  const PossessCodeModal = lazy(() => import("#lib/components/modals/PossessCodeModal.svelte"));
  const ShareNotifyPermissionModal = lazy(
    () => import("#lib/components/modals/ShareNotifyPermissionModal.svelte"),
  );

  const notifications = inject(NotificationsPort);

  let possessOpen = $state(false);
  let due = $state(false);
  let handoffSettled = $state(false);

  const reminderOpen = $derived(
    due && handoffSettled && !possessOpen && !uiStore.anyModalOpen && !updated.current,
  );

  function gotoHostShare() {
    goto("/share/?hostid=" + deviceStore.identity.peerId);
  }

  function openGenerateGate() {
    if (!notifications.needsPermissionForHostShare) {
      gotoHostShare();
      return;
    }

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      gotoHostShare();
      return;
    }

    uiStore.shareNotifyDenied =
      typeof Notification === "undefined" || Notification.permission === "denied";
    uiStore.shareNotifyModalOpen = true;
  }

  function handleGenerateClick() {
    feedback.light();
    openGenerateGate();
  }

  function handlePossessClick() {
    feedback.light();
    possessOpen = true;
  }

  function dismissReminder() {
    if (!reminderOpen) return;
    due = false;
    void readVisitCount().then((visitCount) => dismissDonationReminder(visitCount));
  }

  function closeShareNotify() {
    uiStore.shareNotifyModalOpen = false;
    // A cancelled incoming-share handoff stays on home, which is calm again.
    handoffSettled = true;
  }

  async function handleShareNotifyContinue() {
    const granted = await notifications.ensurePermission();
    if (granted) {
      uiStore.shareNotifyModalOpen = false;
      gotoHostShare();
      return;
    }
    uiStore.shareNotifyDenied = true;
  }

  onMount(() => {
    void recordAppVisit().then((isDue) => {
      due = isDue;
    });

    void hasSharedRecords().then((shared) => {
      if (shared) {
        openGenerateGate();
        return;
      }
      handoffSettled = true;
    });
  });
</script>

<div class="flex min-h-[60vh] items-center justify-center py-6">
  <div class="flex w-full max-w-2xl flex-col gap-3 sm:flex-row">
    <button
      type="button"
      class="card bg-base-100 dark:bg-base-300 hover:border-primary flex-1 border-2 border-transparent text-left shadow-sm transition-colors"
      onclick={handleGenerateClick}>
      <div class="card-body gap-2 p-6">
        <div class="flex items-center gap-2">
          <LightningBoltIcon class="text-primary text-2xl" />
          <h2 class="text-lg font-semibold">Gerar um código</h2>
        </div>
        <p class="text-base-content/70 text-sm">
          Crie uma sessão, copie o link e envie para outra pessoa.
        </p>
      </div>
    </button>

    <button
      type="button"
      class="card bg-base-100 dark:bg-base-300 hover:border-primary flex-1 border-2 border-transparent text-left shadow-sm transition-colors"
      onclick={handlePossessClick}>
      <div class="card-body gap-2 p-6">
        <div class="flex items-center gap-2">
          <NumericIcon class="text-primary text-2xl" />
          <h2 class="text-lg font-semibold">Possuo um código</h2>
        </div>
        <p class="text-base-content/70 text-sm">
          Entre com o PIN de {SHARE_CODE_DIGITS} dígitos para se conectar.
        </p>
      </div>
    </button>
  </div>
</div>

<PossessCodeModal
  open={possessOpen}
  onClose={() => (possessOpen = false)}
  onFound={(code: string) => {
    possessOpen = false;
    goto("/share/?code=" + code);
  }} />

<LazyModal open={reminderOpen}>
  <DonationReminderModal
    open={reminderOpen}
    onDismiss={dismissReminder} />
</LazyModal>

<LazyModal open={uiStore.shareNotifyModalOpen}>
  <ShareNotifyPermissionModal
    open={uiStore.shareNotifyModalOpen}
    denied={uiStore.shareNotifyDenied}
    onClose={closeShareNotify}
    onContinue={handleShareNotifyContinue} />
</LazyModal>
