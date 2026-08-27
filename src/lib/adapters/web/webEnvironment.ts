import type { EnvironmentPort } from "#lib/ports/environment.js";

export class WebEnvironment implements EnvironmentPort {
  readonly isNative = false;
  readonly hasNativeFs = false;
}
