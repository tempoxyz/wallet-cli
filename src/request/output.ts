import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { PaymentReceipt } from "../payment/receipt.js";
import { usageError } from "../shared/errors.js";
import { responseBodyNetworkError } from "./fetch.js";
import { privateKeyFlagWarning, type privateKeySigner } from "./identity.js";
import type { RequestOptions } from "./options.js";

async function* readResponseBody(
  body: ReadableStream<Uint8Array>,
  method: string,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    while (true) {
      const { done, value } = await reader.read().catch(responseBodyNetworkError(method));
      if (done) return;
      yield value;
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function writeResponseBody(
  response: Response,
  options: RequestOptions,
  stdout: Pick<NodeJS.WriteStream, "write">,
  method: string,
) {
  const outputPath =
    options.output ?? (options.remoteName ? remoteNamePath(options.url) : undefined);
  const includeHeaders = options.includeHeaders || options.head;
  const headerText = includeHeaders ? responseHeaderText(response) : "";

  if (options.head) {
    await writeOutput(outputPath, headerText, stdout);
    return;
  }

  if (options.sseJson) {
    if (outputPath) {
      try {
        await mkdir(dirname(outputPath), { recursive: true });
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
      await pipeline(
        (options) => sseToNdjson(response, headerText, options?.signal),
        createWriteStream(outputPath),
      );
    } else if (stdout instanceof Writable) {
      await pipeline((options) => sseToNdjson(response, headerText, options?.signal), stdout, {
        end: false,
      });
    } else {
      for await (const chunk of sseToNdjson(response, headerText)) write(stdout, chunk);
    }
    return;
  }

  if (options.stream || options.sse) {
    const body = response.body;
    if (!body) return;
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      if (headerText) await writeFile(outputPath, headerText);
      await pipeline(
        ({ signal } = {}) => readResponseBody(body, method, signal),
        createWriteStream(outputPath, { flags: headerText ? "a" : "w" }),
      );
    } else {
      await write(stdout, headerText);
      await pipeline(({ signal } = {}) => readResponseBody(body, method, signal), process.stdout);
    }
    return;
  }

  const body = Buffer.from(await response.arrayBuffer().catch(responseBodyNetworkError(method)));
  await writeOutput(
    outputPath,
    headerText ? Buffer.concat([Buffer.from(headerText), body]) : body,
    stdout,
  );
}

export async function writeOutput(
  path: string | undefined,
  text: string | Uint8Array,
  stdout: Pick<NodeJS.WriteStream, "write">,
) {
  if (!path) {
    await write(stdout, text);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

export async function writeHeadersFile(path: string, response: Response) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, responseHeaderText(response));
}

export async function writeMetaFile(
  path: string,
  response: Response,
  started: number,
  signer?: ReturnType<typeof privateKeySigner>,
  payment?: PaymentReceipt & { outcome?: "unknown" },
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        status: response.status,
        url: response.url,
        elapsed_ms: Date.now() - started,
        headers: Object.fromEntries(response.headers.entries()),
        ...(signer
          ? {
              signer: {
                address: signer.account.address,
                source: signer.source,
                ...(signer.source === "flag" ? { warning: privateKeyFlagWarning } : {}),
              },
            }
          : {}),
        ...(payment ? { payment } : {}),
      },
      null,
      2,
    )}\n`,
  );
}

function responseHeaderText(response: Response) {
  const lines = [`HTTP ${response.status}`];
  for (const [name, value] of response.headers.entries()) lines.push(`${name}: ${value}`);
  return `${lines.join("\n")}\n\n`;
}

export function remoteNamePath(value: string) {
  const name = basename(new URL(value).pathname);
  if (!name || name === "." || name === ".." || name.includes("/"))
    throw usageError("Could not derive a safe remote filename from URL");
  return name;
}

async function* sseToNdjson(response: Response, headerText: string, signal?: AbortSignal) {
  if (!response.body) {
    if (headerText) yield headerText;
    return;
  }
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel(signal?.reason).catch(() => undefined);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let pending = "";
  let skipLeadingLf = false;
  let eventName = "data";
  let data: string[] = [];
  try {
    if (headerText) yield headerText;
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      while (true) {
        if (skipLeadingLf) {
          if (pending.length === 0) break;
          if (pending[0] === "\n") pending = pending.slice(1);
          skipLeadingLf = false;
        }
        const boundary = pending.search(/[\r\n]/);
        if (boundary < 0) break;
        const line = pending.slice(0, boundary);
        skipLeadingLf = pending[boundary] === "\r";
        pending = pending.slice(boundary + 1);
        if (line === "") {
          if (data.length > 0)
            yield `${JSON.stringify({ event: eventName, data: parseSseData(data.join("\n")), ts: new Date().toISOString() })}\n`;
          eventName = "data";
          data = [];
        } else {
          const separator = line.indexOf(":");
          const field = separator < 0 ? line : line.slice(0, separator);
          const raw = separator < 0 ? "" : line.slice(separator + 1);
          const value = raw.startsWith(" ") ? raw.slice(1) : raw;
          if (field === "event") eventName = value || "data";
          else if (field === "data") data.push(value);
        }
      }
      // SSE dispatches only events terminated by a blank line.
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

function parseSseData(data: string) {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

export function write(stdout: Pick<NodeJS.WriteStream, "write">, text: string | Uint8Array) {
  const stream = stdout as Pick<NodeJS.WriteStream, "write"> & {
    off?: NodeJS.WriteStream["off"];
    once?: NodeJS.WriteStream["once"];
  };
  if (!stream.once || !stream.off) {
    stream.write(text);
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    stream.once?.("error", onError);
    stream.write(text, (error) => {
      if (error) {
        reject(error);
        return;
      }
      stream.off?.("error", onError);
      resolve();
    });
  });
}
