import type { EnvironmentPort } from "#lib/ports/environment.js";

export class NativeEnvironment implements EnvironmentPort {
  readonly isNative = true;
  readonly hasNativeFs = true;
}
