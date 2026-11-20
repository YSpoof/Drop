import { EnvironmentPort } from "#lib/ports/environment.js";

export class DesktopEnvironment extends EnvironmentPort {
  readonly isDesktop = true;
  readonly hasDesktopFs = true;
}
