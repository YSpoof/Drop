export type PickedFile = {
  file: File;
  path: string;
};

export type PickerPort = {
  /** False in the browser, where the hidden `<input type="file">` elements are used instead. */
  readonly canPick: boolean;
  pickFiles(): Promise<PickedFile[]>;
  pickFolder(): Promise<PickedFile[]>;
};
