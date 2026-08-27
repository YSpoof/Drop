export type EnvironmentPort = {
  /** True when running inside the Electron shell */
  readonly isNative: boolean;
  /** Whether the platform supports streaming to the FS (always true on native) */
  readonly hasNativeFs: boolean;
};
