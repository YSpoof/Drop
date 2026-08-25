import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import { assertConnected, createPeerPages, hostShare, joinWithCode } from "../helpers/peers";
import { sendFileAndExpectReceived } from "../helpers/transfer";

const helloFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/test-files/hello.txt",
);

test.describe.configure({ mode: "serial" });

test.describe("code join", () => {
  test("guest joins by link and receives a file", async ({ browser }) => {
    const [host, guest] = await createPeerPages(browser, 2);

    const { url } = await hostShare(host);
    await guest.goto(url);

    await assertConnected(guest);
    await assertConnected(host);
    await sendFileAndExpectReceived(host, guest, helloFile, "hello.txt");
  });

  test("guest joins by PIN and receives a file", async ({ browser }) => {
    const [host, guest] = await createPeerPages(browser, 2);

    const { code } = await hostShare(host);
    await joinWithCode(guest, code);

    await assertConnected(guest);
    await assertConnected(host);
    await sendFileAndExpectReceived(host, guest, helloFile, "hello.txt");
  });
});
