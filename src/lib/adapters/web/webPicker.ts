import { PickerPort, type PickedFile } from "#lib/ports/picker.js";

/** No-op: the browser picks through the hidden `<input type="file">` elements. */
export class WebPicker extends PickerPort {
  readonly canPick = false;

  async pickFiles(): Promise<PickedFile[]> {
    return [];
  }

  async pickFolder(): Promise<PickedFile[]> {
    return [];
  }
}
