import type { IncomingMessage } from "node:http";

import type { ClientMessage, PeerInfo, ServerMessage } from "$lib/utils/signaling/types";
import type { WebSocket } from "ws";

import { isPrivateOctet } from "../../utils/net/privateIp";

interface StoredPeer {
  ws: WebSocket;
  peerId: string;
  displayName: string;
  deviceHint: string;
  room?: string;
  localIps: string[];
  subnets: string[];
  publicIp: string;
  hasAutoKey?: boolean;
}

const peers = new Map<string, StoredPeer>();

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() ?? "";
  }
  const remote = req.socket.remoteAddress ?? "";
  return remote.replace(/^::ffff:/, "");
}

function ipToSubnet24(ip: string): string | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  const [a, b, c] = nums;
  if (!isPrivateOctet(a, b)) return null;
  return `${a}.${b}.${c}.0/24`;
}

function extractSubnets(localIps: string[]): string[] {
  const subnets = new Set<string>();
  for (const ip of localIps) {
    const subnet = ipToSubnet24(ip);
    if (subnet) subnets.add(subnet);
  }
  return [...subnets];
}

function toPeerInfo(peer: StoredPeer, nearby: boolean): PeerInfo {
  return {
    peerId: peer.peerId,
    displayName: peer.displayName,
    deviceHint: peer.deviceHint,
    room: peer.room,
    nearby,
    hasAutoKey: peer.hasAutoKey,
  };
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function getPeer(peerId: string): StoredPeer | undefined {
  return peers.get(peerId);
}

function areNearby(a: StoredPeer, b: StoredPeer): boolean {
  if (a.publicIp && b.publicIp && a.publicIp === b.publicIp) return true;
  return a.subnets.some((subnet) => b.subnets.includes(subnet));
}

/**
 * Broadcasts the updated list of peers to everyone connected.
 * Peers are grouped by room matching and local network (IP/subnet) proximity.
 */
function broadcastPeerLists() {
  for (const peer of peers.values()) {
    const seen = new Set<string>();
    const peerList: PeerInfo[] = [];

    for (const other of peers.values()) {
      if (other.peerId === peer.peerId || seen.has(other.peerId)) continue;

      const inRoom = peer.room && other.room === peer.room;
      const nearby = areNearby(peer, other);

      if (inRoom || nearby) {
        seen.add(other.peerId);
        peerList.push(toPeerInfo(other, nearby));
      }
    }

    send(peer.ws, { type: "peer-list", peers: peerList });
  }
}

function removePeer(peerId: string) {
  peers.delete(peerId);
  broadcastPeerLists();
}

function handleMessage(ws: WebSocket, raw: string, connectionPublicIp: string) {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }

  const sender = [...peers.values()].find((p) => p.ws === ws);

  switch (message.type) {
    case "announce": {
      const subnets = extractSubnets(message.localIps);
      const existing = peers.get(message.peerId);
      const publicIp = existing?.publicIp || connectionPublicIp;

      peers.set(message.peerId, {
        ws,
        peerId: message.peerId,
        displayName: message.displayName,
        deviceHint: message.deviceHint,
        room: message.room,
        localIps: message.localIps,
        subnets,
        publicIp,
        hasAutoKey: message.hasAutoKey,
      });
      broadcastPeerLists();
      break;
    }
    case "connect-request": {
      const target = getPeer(message.targetPeerId);
      if (!target || !sender) return;
      send(target.ws, {
        type: "connect-request",
        requester: toPeerInfo(sender, areNearby(sender, target)),
        autoKey: message.autoKey,
      });
      break;
    }
    case "connect-response": {
      const target = getPeer(message.targetPeerId);
      if (!target || !sender) return;
      send(target.ws, {
        type: "connect-response",
        accepted: message.accepted,
        targetPeerId: sender.peerId,
      });
      break;
    }
    case "sdp-offer": {
      const target = getPeer(message.targetPeerId);
      if (!target || !sender) return;
      send(target.ws, {
        type: "sdp-offer",
        fromPeerId: sender.peerId,
        sdp: message.sdp,
      });
      break;
    }
    case "sdp-answer": {
      const target = getPeer(message.targetPeerId);
      if (!target || !sender) return;
      send(target.ws, {
        type: "sdp-answer",
        fromPeerId: sender.peerId,
        sdp: message.sdp,
      });
      break;
    }
    case "ice-candidate": {
      const target = getPeer(message.targetPeerId);
      if (!target || !sender) return;
      send(target.ws, {
        type: "ice-candidate",
        fromPeerId: sender.peerId,
        candidate: message.candidate,
      });
      break;
    }
  }
}

export function handleSignalingConnection(ws: WebSocket, req: IncomingMessage) {
  const publicIp = getClientIp(req);
  let registeredPeerId: string | null = null;

  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString();
    handleMessage(ws, raw, publicIp);

    try {
      const parsed = JSON.parse(raw) as ClientMessage;
      if (parsed.type === "announce") {
        registeredPeerId = parsed.peerId;
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    if (registeredPeerId) removePeer(registeredPeerId);
    else {
      for (const [peerId, peer] of peers) {
        if (peer.ws === ws) {
          removePeer(peerId);
          break;
        }
      }
    }
  });
}
