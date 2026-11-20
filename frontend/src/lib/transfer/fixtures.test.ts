import { expect, test } from "vitest";

import { pairLinks, settle, type Endpoint } from "./fixtures";
import { packFrame, unpackFrame, type ControlMessage } from "./protocol";

function recorder() {
  const controls: ControlMessage[] = [];
  const frames: Uint8Array[] = [];
  const endpoint: Endpoint = {
    onControl: (message) => controls.push(message),
    onFrame: (frame) => frames.push(frame),
  };
  return { controls, frames, endpoint };
}

test("paired links carry control messages and frames each way, in order", async () => {
  const [a, b] = pairLinks();
  const atA = recorder();
  const atB = recorder();
  a.peer = atB.endpoint;
  b.peer = atA.endpoint;

  a.sendControl({ type: "pull", fileId: "1" });
  a.sendControl({ type: "bye" });
  await a.sendFrame(packFrame(3, new Uint8Array([7])));
  b.sendControl({ type: "ack", fileId: "2" });
  await b.sendFrame(packFrame(4, new Uint8Array([8, 9])));
  await settle();

  expect(atB.controls).toStrictEqual([{ type: "pull", fileId: "1" }, { type: "bye" }]);
  expect(atA.controls).toStrictEqual([{ type: "ack", fileId: "2" }]);
  expect(atB.frames.map((f) => unpackFrame(f)?.streamId)).toStrictEqual([3]);
  expect([...unpackFrame(atA.frames[0]!)!.bytes]).toStrictEqual([8, 9]);
  expect(a.sent("pull")).toHaveLength(1);
});

test("delivery is asynchronous, like a data channel", async () => {
  const [a, b] = pairLinks();
  const atB = recorder();
  a.peer = atB.endpoint;
  b.peer = recorder().endpoint;
  a.sendControl({ type: "bye" });
  expect(atB.controls).toHaveLength(0);
  await settle();
  expect(atB.controls).toHaveLength(1);
});

test("closing one side closes both, drops traffic and rejects frames", async () => {
  const [a, b] = pairLinks();
  const atB = recorder();
  a.peer = atB.endpoint;
  a.sendControl({ type: "bye" });
  b.close();
  await settle();
  expect(a.closed.aborted).toBe(true);
  expect(atB.controls).toHaveLength(0);
  a.sendControl({ type: "bye" });
  await expect(a.sendFrame(new Uint8Array(4))).rejects.toThrow("Link closed");
});
