import { EnvironmentPort } from "#lib/ports/environment.js";

export class NativeEnvironment extends EnvironmentPort {
  readonly isNative = true;
  readonly hasNativeFs = true;
}
