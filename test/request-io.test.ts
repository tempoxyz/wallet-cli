import { execFile } from "node:child_process";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { executeRequest, parseRequestArgs, runRequest } from "../src/commands/request.js";
import { useTempHome } from "./helpers.js";

const execFileAsync = promisify(execFile);
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        instance.closeAllConnections();
        instance.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
}
function capture() {
  let text = "";
  return {
    write(chunk: string | Uint8Array) {
      text += Buffer.from(chunk).toString();
      return true;
    },
    text: () => text,
  };
}

it.each(["\n", "\r\n", "\r"])(
  "streams SSE with %j framing before EOF, preserving split UTF-8",
  async (newline) => {
    let finish: (() => void) | undefined;
    const url = await server((_req, res) => {
      res.setHeader("content-type", "text/event-stream");
      const bytes = Buffer.from(`event: token${newline}data: "café"${newline}${newline}`);
      const split = bytes.indexOf(Buffer.from("é")) + 1;
      res.write(bytes.subarray(0, split));
      setImmediate(() => {
        res.write(bytes.subarray(split));
      });
      finish = () =>
        res.end(`data: first${newline}data:  second${newline}${newline}data: unfinished`);
    });
    const stdout = capture();
    const request = runRequest(["--sse-json", url], { stdout });
    try {
      await expect.poll(() => stdout.text(), { timeout: 2000 }).toContain('"data":"café"');
    } finally {
      finish?.();
    }
    await request;
    const events = stdout
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toMatchObject([
      { event: "token", data: "café" },
      { event: "data", data: "first\n second" },
    ]);
  },
);

it("writes SSE JSON to a nested output file without stdout", async () => {
  const home = await useTempHome();
  const path = join(home, "new", "events.jsonl");
  const url = await server((_req, res) => res.end("data: {}\r\n\r\ndata:\r\n\r\n"));
  const stdout = capture();
  await runRequest(["--sse-json", "-o", path, url], { stdout });
  expect(stdout.text()).toBe("");
  expect(
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).data),
  ).toEqual([{}, ""]);
});

it("cancels an open SSE response when its output stream fails", async () => {
  const outputPath = await useTempHome();
  let upstreamClosed = false;
  const url = await server((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    res.on("close", () => {
      upstreamClosed = true;
    });
  });
  await expect(runRequest(["--sse-json", "-o", outputPath, url])).rejects.toThrow();
  await expect.poll(() => upstreamClosed).toBe(true);
});

it("cancels an open SSE response when an injected Writable fails asynchronously", async () => {
  let upstreamClosed = false;
  let finish: (() => void) | undefined;
  const url = await server((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: 1\n\n");
    res.on("close", () => {
      upstreamClosed = true;
    });
    finish = () => res.end();
  });
  const failure = new Error("output failed");
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      setImmediate(() => callback(failure));
    },
  });
  // Keep the pre-fix stream error from becoming an uncaught exception.
  stdout.on("error", () => {});
  let outcome: unknown;
  const request = runRequest(["--sse-json", url], { stdout }).then(
    () => {
      outcome = "resolved";
    },
    (error: unknown) => {
      outcome = error;
    },
  );
  try {
    await expect.poll(() => outcome).toBe(failure);
    await expect.poll(() => upstreamClosed).toBe(true);
  } finally {
    finish?.();
    await request;
  }
});

it("cancels an open SSE response when creating its output directory fails", async () => {
  const home = await useTempHome();
  const parent = join(home, "file");
  await writeFile(parent, "not a directory");
  let upstreamClosed = false;
  const url = await server((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    res.on("close", () => {
      upstreamClosed = true;
    });
  });
  await expect(
    runRequest(["--sse-json", "-o", join(parent, "events.jsonl"), url]),
  ).rejects.toThrow();
  await expect.poll(() => upstreamClosed).toBe(true);
});

it("aborts Retry-After backoff at the request deadline without another request", async () => {
  let requests = 0;
  const url = await server((_req, res) => {
    requests++;
    res.writeHead(503, { "retry-after": "5" });
    res.end("busy");
  });
  const started = Date.now();
  await expect(
    executeRequest({ ...parseRequestArgs([url]), maxTime: 0.1, retries: 2 }),
  ).rejects.toMatchObject({ code: "E_NETWORK" });
  expect(Date.now() - started).toBeLessThan(1500);
  expect(requests).toBe(1);
});

it("preserves repeated multipart fields and files in order", async () => {
  const home = await useTempHome();
  const first = join(home, "first.txt");
  const second = join(home, "second.txt");
  await writeFile(first, "file one");
  await writeFile(second, "file two");
  let received = "";
  const url = await server((req, res) => {
    req.on("data", (chunk) => {
      received += chunk;
    });
    req.on("end", () => res.end("ok"));
  });
  await runRequest(
    ["-F", "tag=alpha", "-F", "tag=beta", "-F", `file=@${first}`, "-F", `file=@${second}`, url],
    { stdout: capture() },
  );
  expect(received.match(/name="tag"/g)).toHaveLength(2);
  expect(received.match(/name="file"/g)).toHaveLength(2);
  expect(received.indexOf("alpha")).toBeLessThan(received.indexOf("beta"));
  expect(received.indexOf("file one")).toBeLessThan(received.indexOf("file two"));
});

it("routes HEAD headers exclusively to -o and creates parent directories", async () => {
  const home = await useTempHome();
  const path = join(home, "missing", "headers.txt");
  const url = await server((req, res) => {
    expect(req.method).toBe("HEAD");
    res.setHeader("x-test", "head");
    res.end();
  });
  const stdout = capture();
  const result = await execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "src/request-cli.ts",
    "-I",
    "-o",
    path,
    url,
  ]);
  expect(result.stdout).toBe("");
  expect(stdout.text()).toBe("");
  expect(await readFile(path, "utf8")).toContain("x-test: head");
});

it("handles a CRLF separator split between network writes", async () => {
  let sendRest: (() => void) | undefined;
  const url = await server((_req, res) => {
    res.write("data: 1\r\n\r");
    sendRest = () => res.end("\ndata: 2\r\n\r\n");
  });
  const stdout = capture();
  const request = runRequest(["--sse-json", url], { stdout });
  await expect.poll(() => sendRest).toBeTypeOf("function");
  await expect.poll(() => stdout.text()).toContain('"data":1');
  sendRest!();
  await request;
  expect(
    stdout
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).data),
  ).toEqual([1, 2]);
});

it("honors fractional CLI timeout while waiting to retry", async () => {
  let requests = 0;
  let requestStarted = 0;
  const url = await server((_req, res) => {
    requests++;
    // Exclude Node/tsx startup from the request deadline assertion.
    requestStarted = performance.now();
    res.writeHead(503, { "retry-after": "5" });
    res.end("busy");
  });
  await expect(
    execFileAsync(process.execPath, [
      "--import",
      "tsx",
      "src/request-cli.ts",
      "-m",
      "0.1",
      "--retries",
      "2",
      url,
    ]),
  ).rejects.toMatchObject({ code: 3 });
  expect(requests).toBe(1);
  expect(performance.now() - requestStarted).toBeLessThan(2500);
});
