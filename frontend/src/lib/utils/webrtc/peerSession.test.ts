import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_JOIN_CONNECTED_CLOSE_MS, PAIRING_TIMEOUT_MS } from "#lib/consts.js";
import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { uiStore } from "#lib/stores/uiStore.svelte.js";
import type { SignalingClient } from "#lib/utils/signaling/client.js";

import { CodeJoinController } from "./codeJoin";
import { PeerSessionCoordinator } from "./peerSession";
import { createSignalingHandlers } from "./signalingHandlers";

// The real peer store runs without the Svelte compiler: runes become plain values.
vi.hoisted(() => {
  Object.assign(globalThis, {
    $state: (value: unknown) => value,
    $derived: (value: unknown) => value,
  });
});

const fakes = vi.hoisted(() => {
  class FakeRTC extends EventTarget {
    static all: FakeRTC[] = [];
    disposed = false;
    constructor() {
      super();
      FakeRTC.all.push(this);
    }
    channel() {}
    connect(id: string) {
      return { id };
    }
    receive(id: string) {
      return { id };
    }
    dispose() {
      this.disposed = true;
    }
  }

  class FakeLink {
    static all: FakeLink[] = [];
    readonly opened = Promise.withResolvers<void>();
    private readonly stop = new AbortController();
    readonly closed = this.stop.signal;
    readonly chunkSize = 1;
    constructor() {
      FakeLink.all.push(this);
    }
    open() {
      return this.opened.promise;
    }
    close() {
      this.stop.abort();
    }
  }

  const engine = { close: () => undefined, bye: () => undefined };
  const services = {
    start: () => engine,
    clearPendingBatchCompletions: () => undefined,
    abortAll: () => undefined,
    dropIncomplete: async () => undefined,
  };
  return { FakeRTC, FakeLink, engine, services };
});

vi.mock("fastrtc", () => ({ FastRTC: fakes.FakeRTC }));
vi.mock("./link", () => ({ CTRL_LABEL: "ctrl", FILES_LABEL: "files", PeerLink: fakes.FakeLink }));
vi.mock("quick-di", () => ({ inject: () => fakes.services }));
vi.mock("#lib/services/downloadService.js", () => ({ DownloadService: class {} }));
vi.mock("#lib/services/transferService.js", () => ({ TransferService: class {} }));
vi.mock("#lib/stores/transferStore.svelte.js", () => ({
  transferStore: { resetTransferState: () => undefined },
}));
vi.mock("#lib/stores/uiStore.svelte.js", () => ({ uiStore: { codeJoinOpen: false } }));
vi.mock("#lib/stores/deviceStore.svelte.js", () => ({
  deviceStore: { identity: { peerId: "me" } },
}));
vi.mock("#lib/stores/toast.svelte.js", () => ({ toastStore: { showToast: () => undefined } }));
vi.mock("#lib/utils/logger.js", () => ({ logger: { log: () => undefined } }));

const { FakeRTC, FakeLink, engine } = fakes;

function session() {
  const signaling = { send: vi.fn(), stop: vi.fn(), resume: vi.fn() };
  const onJoinFailed = vi.fn();
  let peerSession!: PeerSessionCoordinator;
  const codeJoin = new CodeJoinController(
    signaling as unknown as SignalingClient,
    () => peerSession,
    () => true,
    onJoinFailed,
  );
  peerSession = new PeerSessionCoordinator({
    signaling: signaling as unknown as SignalingClient,
    codeJoin,
  });
  const handlers = createSignalingHandlers({
    peerSession,
    codeJoin,
    joinSignaling: async () => undefined,
    onCodeAssigned: () => undefined,
  });
  return { signaling, onJoinFailed, codeJoin, peerSession, handlers };
}

function peer(peerId: string) {
  return { peerId, displayName: `Device ${peerId}` };
}

/** Lets the link open and `onLinkOpen` run. */
async function openLink(link: InstanceType<typeof FakeLink>) {
  link.opened.resolve();
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

/** A joiner whose code join reached the "connected" phase. */
async function joinedSession() {
  const s = session();
  void s.codeJoin.join("1234");
  s.handlers.onJoinAccepted({ type: "join-accepted", host: peer("host") });
  await openLink(FakeLink.all[0]!);
  expect(peerStore.codeJoinPhase).toBe("connected");
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(engine, "close");
  vi.spyOn(transferStore, "resetTransferState");
  FakeRTC.all = [];
  FakeLink.all = [];
  uiStore.codeJoinOpen = false;
  Object.assign(peerStore, {
    connectingPeerId: null,
    connectedPeerId: null,
    connectedPeerInfo: null,
    connectedViaLan: false,
    codeJoinPhase: "waiting",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("code join overlay", () => {
  it("closing it in the connected phase keeps the connection", async () => {
    const { codeJoin, peerSession, signaling, onJoinFailed } = await joinedSession();
    vi.mocked(transferStore.resetTransferState).mockClear();
    signaling.stop.mockClear();

    codeJoin.cancel();
    vi.advanceTimersByTime(CODE_JOIN_CONNECTED_CLOSE_MS + PAIRING_TIMEOUT_MS);

    expect(uiStore.codeJoinOpen).toBe(false);
    expect(peerStore.connectedPeerId).toBe("host");
    expect(peerStore.connectedPeerInfo?.peerId).toBe("host");
    expect(peerSession.getEngine()).toBe(engine);
    expect(engine.close).not.toHaveBeenCalled();
    expect(FakeRTC.all[0]!.disposed).toBe(false);
    expect(transferStore.resetTransferState).not.toHaveBeenCalled();
    expect(signaling.stop).not.toHaveBeenCalled();
    expect(onJoinFailed).not.toHaveBeenCalled();
  });

  it("cancelling while connecting drops the pairing through the peer session", async () => {
    const { codeJoin, handlers, onJoinFailed } = session();
    const join = codeJoin.join("1234");
    handlers.onJoinAccepted({ type: "join-accepted", host: peer("host") });
    expect(peerStore.connectingPeerId).toBe("host");
    await expect(join).resolves.toBeNull();

    codeJoin.cancel();

    expect(uiStore.codeJoinOpen).toBe(false);
    expect(peerStore.connectingPeerId).toBeNull();
    expect(FakeRTC.all[0]!.disposed).toBe(true);
    expect(transferStore.resetTransferState).toHaveBeenCalled();
    expect(onJoinFailed).toHaveBeenCalledWith("Conexão cancelada");
  });

  it("a failed join with an open link closes the engine and resets the stores", async () => {
    const { codeJoin, peerSession } = await joinedSession();

    codeJoin.fail("Falha na conexão");

    expect(engine.close).toHaveBeenCalled();
    expect(peerSession.getEngine()).toBeNull();
    expect(peerSession.hasPeerConnection()).toBe(false);
    expect(peerStore.connectedPeerId).toBeNull();
    expect(transferStore.resetTransferState).toHaveBeenCalled();
  });

  it("a pairing that never opens fails the join after the pairing timeout", () => {
    const { codeJoin, handlers, onJoinFailed } = session();
    void codeJoin.join("1234");
    handlers.onJoinAccepted({ type: "join-accepted", host: peer("host") });

    vi.advanceTimersByTime(PAIRING_TIMEOUT_MS);

    expect(FakeRTC.all[0]!.disposed).toBe(true);
    expect(peerStore.connectingPeerId).toBeNull();
    expect(onJoinFailed).toHaveBeenCalledWith("Falha na conexão");
  });
});

describe("host pairing", () => {
  it("ignores a second PIN holder while a pairing is in progress", () => {
    const { handlers } = session();
    handlers.onPeerJoining({ type: "peer-joining", requester: peer("a") });
    expect(peerStore.connectingPeerId).toBe("a");

    handlers.onPeerJoining({ type: "peer-joining", requester: peer("b") });

    expect(FakeRTC.all).toHaveLength(1);
    expect(FakeRTC.all[0]!.disposed).toBe(false);
    expect(peerStore.connectingPeerId).toBe("a");
    expect(peerStore.connectedPeerInfo?.peerId).toBe("a");
  });

  it("ignores a second PIN holder once connected", async () => {
    const { handlers } = session();
    handlers.onPeerJoining({ type: "peer-joining", requester: peer("a") });
    await openLink(FakeLink.all[0]!);

    handlers.onPeerJoining({ type: "peer-joining", requester: peer("b") });

    expect(FakeRTC.all).toHaveLength(1);
    expect(peerStore.connectedPeerId).toBe("a");
  });

  it("lets the same peer re-pair with a fresh connection", () => {
    const { handlers } = session();
    handlers.onPeerJoining({ type: "peer-joining", requester: peer("a") });

    handlers.onPeerJoining({ type: "peer-joining", requester: peer("a") });

    expect(FakeRTC.all).toHaveLength(2);
    expect(FakeRTC.all[0]!.disposed).toBe(true);
    expect(FakeRTC.all[1]!.disposed).toBe(false);
    expect(peerStore.connectingPeerId).toBe("a");
  });

  it("frees the session for another peer when a pairing never opens", () => {
    const { handlers } = session();
    handlers.onPeerJoining({ type: "peer-joining", requester: peer("a") });

    vi.advanceTimersByTime(PAIRING_TIMEOUT_MS);
    expect(peerStore.connectingPeerId).toBeNull();
    handlers.onPeerJoining({ type: "peer-joining", requester: peer("b") });

    expect(FakeRTC.all).toHaveLength(2);
    expect(peerStore.connectingPeerId).toBe("b");
  });
});
