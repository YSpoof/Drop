import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import { createPeerPages, joinRemoteRoom, setupRemoteRoom } from "../helpers/peers";
import { sendFileAndExpectReceived } from "../helpers/transfer";

const helloFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/test-files/hello.txt",
);

test.describe.configure({ mode: "serial" });

test.describe("remote connection — auto", () => {
  test("guest auto-connects and receives a file", async ({ browser }) => {
    const [host, guest] = await createPeerPages(browser, 2);

    const roomUrl = await setupRemoteRoom(host, "auto");
    await joinRemoteRoom(guest, roomUrl, { mode: "auto", acceptOnHost: host });
    await sendFileAndExpectReceived(host, guest, helloFile, "hello.txt");
  });
});
