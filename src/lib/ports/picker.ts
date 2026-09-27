export type PickedFile = {
  file: File;
  path: string;
};

export abstract class PickerPort {
  /** False in the browser, where the hidden `<input type="file">` elements are used instead. */
  abstract readonly canPick: boolean;
  abstract pickFiles(): Promise<PickedFile[]>;
  abstract pickFolder(): Promise<PickedFile[]>;
}
