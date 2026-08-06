import { loadIdentity, saveDisplayName } from "$lib/utils/device/identity";

const identity = await loadIdentity();

class DeviceStore {
  readonly identity = identity;
  displayName = $state(identity.displayName);

  handleDisplayNameBlur() {
    saveDisplayName(this.displayName);
  }
}

export const deviceStore = new DeviceStore();
