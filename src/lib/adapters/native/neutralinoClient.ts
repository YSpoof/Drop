import { init } from "@neutralinojs/lib";

/** Opens the WebSocket to the framework. Native calls queue until it is ready. */
export function startNeutralino(): void {
  // The client library picks the socket host from `location.hostname`, which here is the
  // remote app origin instead of the local framework server. This flag forces 127.0.0.1.
  window.NL_GINJECTED = true;
  init();
}
