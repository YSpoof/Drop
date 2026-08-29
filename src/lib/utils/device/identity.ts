import { localForage } from "#lib/utils/localForage.js";

const PEER_ID_KEY = "peerId";
const DISPLAY_NAME_KEY = "displayName";

const ADJECTIVES = [
  "Swift",
  "Quiet",
  "Brave",
  "Calm",
  "Bright",
  "Clever",
  "Gentle",
  "Lucky",
  "Merry",
  "Noble",
  "Quick",
  "Sunny",
  "Wild",
  "Zesty",
];

const NOUNS = [
  "Falcon",
  "River",
  "Panda",
  "Comet",
  "Maple",
  "Otter",
  "Pixel",
  "Quartz",
  "Spruce",
  "Tiger",
  "Violet",
  "Willow",
  "Badger",
  "Cedar",
];

export interface DeviceIdentity {
  peerId: string;
  displayName: string;
}

function randomDisplayName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adjective} ${noun}`;
}

async function loadPeerId(): Promise<string> {
  const stored = await localForage.getItem<string>(PEER_ID_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  await localForage.setItem(PEER_ID_KEY, id);
  return id;
}

async function loadDisplayName(): Promise<string> {
  const stored = await localForage.getItem<string>(DISPLAY_NAME_KEY);
  if (stored) return stored;

  const name = randomDisplayName();
  await localForage.setItem(DISPLAY_NAME_KEY, name);
  return name;
}

export async function loadIdentity(): Promise<DeviceIdentity> {
  return {
    peerId: await loadPeerId(),
    displayName: await loadDisplayName(),
  };
}

export async function saveDisplayName(name: string) {
  localForage.setItem(DISPLAY_NAME_KEY, name);
}
