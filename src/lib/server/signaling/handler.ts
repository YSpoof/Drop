import { randomInt } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { WebSocket } from "ws";

import type { ClientMessage, PeerInfo, ServerMessage } from "#lib/utils/signaling/types.js";

import { isPublicIpv4 } from "../../utils/net/privateIp.ts";

interface StoredPeer {
  ws: WebSocket;
  peerId: string;
  displayName: string;
  deviceHint: string;
  code?: string;
  publicIpv4?: string;
}

const peers = new Map<string, StoredPeer>();
const codes = new Map<string, string>();

function toPeerInfo(peer: StoredPeer): PeerInfo {
  return {
    peerId: peer.peerId,
    displayName: peer.displayName,
    deviceHint: peer.deviceHint,
  };
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function samePublicIp(a: StoredPeer, b: StoredPeer): boolean {
  return !!(a.publicIpv4 && b.publicIpv4 && a.publicIpv4 === b.publicIpv4);
}

function normalizeCode(code: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  const trimmed = code.trim();
  return /^\d{6}$/.test(trimmed) ? trimmed : undefined;
}

function generateUniqueCode(): string {
  for (let i = 0; i < 50; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    if (!codes.has(code)) return code;
  }
  throw new Error("Failed to allocate share code");
}

function freeOwnedCode(peerId: string, code: string | undefined) {
  if (code && codes.get(code) === peerId) {
    codes.delete(code);
  }
}

function removePeer(peerId: string) {
  const peer = peers.get(peerId);
  if (peer) freeOwnedCode(peerId, peer.code);
  peers.delete(peerId);
}

function relay(
  sender: StoredPeer | undefined,
  targetPeerId: string,
  build: (from: StoredPeer, target: StoredPeer) => ServerMessage,
) {
  const target = peers.get(targetPeerId);
  if (!sender || !target) return;
  send(target.ws, build(sender, target));
}

function handleMessage(ws: WebSocket, message: ClientMessage, senderId: string | null) {
  const sender = senderId ? peers.get(senderId) : undefined;

  switch (message.type) {
    case "announce": {
      const previous = peers.get(message.peerId)?.code;
      const requested = normalizeCode(message.code);
      const reusable = previous && codes.get(previous) === message.peerId ? previous : undefined;
      const code = message.host ? (requested ?? reusable ?? generateUniqueCode()) : undefined;

      if (previous !== code) freeOwnedCode(message.peerId, previous);
      if (code && (codes.get(code) ?? message.peerId) === message.peerId) {
        codes.set(code, message.peerId);
      }

      const publicIpv4 =
        typeof message.publicIpv4 === "string" && isPublicIpv4(message.publicIpv4)
          ? message.publicIpv4
          : undefined;

      peers.set(message.peerId, {
        ws,
        peerId: message.peerId,
        displayName: message.displayName,
        deviceHint: message.deviceHint,
        code,
        publicIpv4,
      });

      if (code && !requested && !reusable) {
        send(ws, { type: "code-assigned", code });
      }
      break;
    }
    case "join-code": {
      const code = normalizeCode(message.code);
      const owner = code ? peers.get(codes.get(code) ?? "") : undefined;

      if (!sender || !owner || owner.peerId === sender.peerId) {
        send(ws, { type: "join-rejected" });
        break;
      }

      const lan = samePublicIp(sender, owner);
      send(owner.ws, {
        type: "peer-joining",
        requester: toPeerInfo(sender),
        ...(lan ? { lan: true } : {}),
      });
      send(ws, {
        type: "join-accepted",
        host: toPeerInfo(owner),
        ...(lan ? { lan: true } : {}),
      });
      break;
    }
    case "sdp-offer":
      relay(sender, message.targetPeerId, (from) => ({
        type: "sdp-offer",
        fromPeerId: from.peerId,
        sdp: message.sdp,
        iceMode: message.iceMode,
      }));
      break;
    case "sdp-answer":
      relay(sender, message.targetPeerId, (from) => ({
        type: "sdp-answer",
        fromPeerId: from.peerId,
        sdp: message.sdp,
      }));
      break;
    case "ice-candidate":
      relay(sender, message.targetPeerId, (from) => ({
        type: "ice-candidate",
        fromPeerId: from.peerId,
        candidate: message.candidate,
      }));
      break;
    case "ping":
      send(ws, { type: "pong" });
      break;
  }
}

export function handleSignalingConnection(ws: WebSocket, _req: IncomingMessage) {
  let registeredPeerId: string | null = null;

  ws.on("message", (data) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof data === "string" ? data : data.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (message.type === "announce") registeredPeerId = message.peerId;
    handleMessage(ws, message, registeredPeerId);
  });

  ws.on("close", () => {
    if (registeredPeerId) removePeer(registeredPeerId);
  });
}
