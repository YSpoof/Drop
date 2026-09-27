export abstract class EnvironmentPort {
  /** True when running inside the Electron shell */
  abstract readonly isNative: boolean;
  /** Whether the platform supports streaming to the FS (always true on native) */
  abstract readonly hasNativeFs: boolean;
}
