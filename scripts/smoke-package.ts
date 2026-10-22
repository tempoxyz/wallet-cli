import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { brotliCompressSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const binary = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Pass the packaged binary to smoke test");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  version: string;
};
const version = process.env.TEMPO_WALLET_VERSION ?? packageJson.version;
const home = await mkdtemp(join(tmpdir(), "tempo-package-smoke-"));
const body = "packaged Brotli response OK\n";
const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/plain", "content-encoding": "br" });
  response.end(brotliCompressSync(body));
});

try {
  // The bundle's startup guard rejects a binary with any runtime other than .node-version.
  assert.equal((await run(["--version"])).trim(), version);
  const description = JSON.parse(await run(["--describe"])) as { name: string };
  assert.ok(["tempo wallet", "tempo request"].includes(description.name));
  assert.ok((await run(["--help"])).includes(`Usage: ${description.name}`));

  if (description.name === "tempo request") {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(await run([`http://127.0.0.1:${address.port}`, "--compressed"]), body);
  } else {
    // Exercise persistent configuration without touching a user's real wallet or making payments.
    const config = JSON.parse(await run(["config", "get", "--format", "json"]));
    assert.ok(config);
  }
  console.log(
    `Packaged ${description.name}@${version}: runtime, metadata, and smoke checks passed`,
  );
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(home, { recursive: true, force: true });
}

async function run(args: string[]) {
  const { stdout } = await execFileAsync(binary, args, {
    timeout: 15_000,
    env: {
      ...process.env,
      HOME: home,
      XDG_DATA_HOME: join(home, "data"),
      TEMPO_NO_BROWSER: "1",
      TEMPO_PRIVATE_KEY: "",
      TEMPO_RPC_URL: "http://127.0.0.1:9",
      TEMPO_AUTH_URL: "http://127.0.0.1:9",
    },
  });
  return stdout;
}
