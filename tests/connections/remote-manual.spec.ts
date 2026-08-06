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

test.describe("remote connection — manual", () => {
  test("host approves guest and transfers a file", async ({ browser }) => {
    const [host, guest] = await createPeerPages(browser, 2);

    const roomUrl = await setupRemoteRoom(host, "manual");
    await joinRemoteRoom(guest, roomUrl, { mode: "manual", acceptOnHost: host });
    await sendFileAndExpectReceived(host, guest, helloFile, "hello.txt");
  });
});
