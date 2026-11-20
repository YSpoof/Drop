import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { MiB, nextDownload, randomFile, sha256, tempDir } from "../helpers/bytes";
import { addFiles } from "../helpers/files";
import { assertConnected, createPeerPages, hostShare, joinWithCode } from "../helpers/peers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test.describe.configure({ mode: "serial" });

/** The Rust CLI in quick mode; its stdout is collected so tests can wait for a line. */
class Cli {
  private readonly child: ChildProcess;
  output = "";
  private waiters: (() => void)[] = [];

  constructor(args: string[], home: string) {
    this.child = spawn("cargo", ["run", "-q", "-p", "drop-cli", "--", "--quick", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        // rustup and cargo find their toolchains and config through HOME.
        RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(homedir(), ".rustup"),
        CARGO_HOME: process.env.CARGO_HOME ?? path.join(homedir(), ".cargo"),
        HOME: home,
        DROP_WS_URL: "ws://localhost:8080/ws",
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group, so `kill` also stops the binary cargo started.
      detached: true,
    });
    const collect = (chunk: Buffer) => {
      this.output += chunk.toString();
      for (const wake of this.waiters.splice(0)) wake();
    };
    this.child.stdout!.on("data", collect);
    this.child.stderr!.on("data", collect);
  }

  /** The first match of `pattern` in the output so far or later. */
  async waitFor(pattern: RegExp, timeout = 60_000): Promise<RegExpMatchArray> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const match = this.output.match(pattern);
      if (match) return match;
      if (Date.now() > deadline) throw new Error(`CLI never printed ${pattern}:\n${this.output}`);
      const { promise, resolve } = Promise.withResolvers<void>();
      this.waiters.push(resolve);
      setTimeout(resolve, 1_000);
      await promise;
    }
  }

  kill() {
    if (this.child.exitCode === null) process.kill(-this.child.pid!, "SIGKILL");
  }
}

test.describe("Rust CLI and browser", () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  let cli: Cli | null = null;
  let logs: string[] = [];

  test.beforeEach(async () => {
    tmp = await tempDir();
    logs = [];
  });
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("cli-output", { body: cli?.output ?? "", contentType: "text/plain" });
      await testInfo.attach("browser-console", {
        body: logs.join("\n"),
        contentType: "text/plain",
      });
    }
    cli?.kill();
    cli = null;
    await tmp.remove();
  });

  test("CLI hosts and the browser receives by PIN", async ({ browser }) => {
    const file = await randomFile(tmp.dir, "from-cli.bin", 3 * MiB + 11);
    cli = new Cli(["--host", file.path], tmp.dir);
    const [, pin] = await cli.waitFor(/PIN atribuído: (\d{4})/);

    const [guest] = await createPeerPages(browser, 1);
    guest!.on("console", (message) => logs.push(message.text()));
    const received = nextDownload(guest!);
    await joinWithCode(guest!, pin!);
    await assertConnected(guest!);

    const download = await received;
    expect(download.name).toBe(file.name);
    expect(sha256(download.bytes)).toBe(file.sha256);
    await cli.waitFor(/Transferência concluída: from-cli\.bin/);
  });

  test("browser hosts and the CLI receives by PIN", async ({ browser }) => {
    const file = await randomFile(tmp.dir, "from-browser.bin", 3 * MiB + 13);
    const out = path.join(tmp.dir, "out");
    const [host] = await createPeerPages(browser, 1);
    host!.on("console", (message) => logs.push(message.text()));
    const { code } = await hostShare(host!);

    cli = new Cli(["--code", code, "--out", out], tmp.dir);
    await assertConnected(host!);
    await addFiles(host!, file.path);

    await cli.waitFor(/Recebido: from-browser\.bin/);
    expect(sha256(await readFile(path.join(out, file.name)))).toBe(file.sha256);
    await expect(host!.getByText(/1\/1 enviados/)).toBeVisible();
  });
});
