import { EnvironmentPort } from "#lib/ports/environment.js";

export class WebEnvironment extends EnvironmentPort {
  readonly isNative = false;
  readonly hasNativeFs = false;
}
