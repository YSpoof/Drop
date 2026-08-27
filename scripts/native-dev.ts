import { spawn, type ChildProcess } from "node:child_process";

const DEV_URL = "http://localhost:4321";

const children: ChildProcess[] = [];
let shuttingDown = false;

function spawnInherit(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: "inherit" });
  children.push(child);
  return child;
}

function spawnWait(command: string, args: string[]): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} failed: ${code ?? signal}`));
  });
  return promise;
}

function waitForHttp(url: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();

  const tryFetch = async () => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      resolve();
    } catch {
      setTimeout(tryFetch, 200);
    }
  };

  tryFetch();
  return promise;
}

function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

await spawnWait("pnpm", ["native:compile"]);

const vite = spawnInherit("pnpm", ["dev"]);
vite.on("exit", (code, signal) => {
  if (shuttingDown) return;
  shutdown(signal ? 1 : (code ?? 0));
});

await waitForHttp(DEV_URL);

const electron = spawnInherit("pnpm", ["exec", "electron", "."]);
electron.on("exit", (code, signal) => {
  shutdown(signal ? 1 : (code ?? 0));
});
