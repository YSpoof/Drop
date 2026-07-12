import type { SessionManager } from "./SessionManager";

let active: SessionManager | null = null;

export function registerSession(session: SessionManager): void {
  active = session;
}

export function unregisterSession(session: SessionManager): void {
  if (active === session) active = null;
}

export function abortActiveSession(): void {
  active?.handlePageUnload();
}
