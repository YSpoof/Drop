import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import { connectLocal, createPeerPages } from "../helpers/peers";
import { sendFileAndExpectReceived } from "../helpers/transfer";

const helloFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/test-files/hello.txt",
);

test.describe.configure({ mode: "serial" });

test.describe("local connection", () => {
  test("discovers peer and transfers a file", async ({ browser }) => {
    const [initiator, acceptor] = await createPeerPages(browser, 2);

    await connectLocal(initiator, acceptor);
    await sendFileAndExpectReceived(initiator, acceptor, helloFile, "hello.txt");
  });
});
