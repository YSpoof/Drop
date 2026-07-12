import type { Toast } from "$lib/types";
import vibrate from "$lib/utils/vibrate";

const TOAST_DURATION_BY_TYPE: Record<Toast["type"], number> = {
  success: 3000,
  info: 4000,
  warning: 7000,
  error: 15000,
};

class ToastStore {
  id = 0;
  toastsPool = $state<Toast[]>([]);
  visibleToasts = $derived(this.toastsPool.slice(0, 3));

  showToast(
    message: string,
    type: Toast["type"] = "info",
    duration: number = TOAST_DURATION_BY_TYPE[type],
  ) {
    const toastId = ++this.id;

    this.toastsPool = [
      ...this.toastsPool,
      {
        id: toastId,
        message,
        type,
        duration,
      },
    ];

    switch (type) {
      case "success":
        vibrate.success();
        break;
      case "info":
        vibrate.info();
        break;
      case "warning":
        vibrate.warning();
        break;
      case "error":
        vibrate.error();
        break;
    }
  }

  removeToast(toastId: number) {
    this.toastsPool = this.toastsPool.filter((item) => item.id !== toastId);
  }

  clearToasts() {
    this.toastsPool = [];
  }
}

export const toastStore = new ToastStore();
