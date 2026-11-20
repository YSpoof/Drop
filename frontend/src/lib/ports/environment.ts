export abstract class EnvironmentPort {
  /** True when running inside the Electron shell */
  abstract readonly isDesktop: boolean;
  /** Whether the platform supports streaming to the FS (always true on desktop) */
  abstract readonly hasDesktopFs: boolean;
}
