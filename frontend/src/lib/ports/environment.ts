export abstract class EnvironmentPort {
  /** True inside the desktop host, which also streams received files to disk. */
  abstract readonly isDesktop: boolean;
}
