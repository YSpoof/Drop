import { init } from "@neutralinojs/lib";

let nativeSocket: WebSocket | null = null;

/** Framework socket opened by `init`. The official client keeps it private. */
export function getNativeSocket(): WebSocket | null {
  return nativeSocket;
}

/** Opens the WebSocket to the framework. Native calls queue until it is ready. */
export function startNeutralino(): void {
  // The client library picks the socket host from `location.hostname`, which here is the
  // remote app origin instead of the local framework server. This flag forces 127.0.0.1.
  window.NL_GINJECTED = true;
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (protocols === undefined) super(url);
      else super(url, protocols);
      if (String(url).includes("connectToken=")) nativeSocket = this;
    }
  };
  init();
  window.WebSocket = NativeWebSocket;
}
