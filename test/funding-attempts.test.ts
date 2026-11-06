import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimAttempt,
  fundingDirectory,
  listAttempts,
  loadAttempt,
  removeAttempt,
  requestFingerprint,
} from "../src/payment/attempts.js";
import { recoverFunding } from "../src/commands/funding/recover.js";
import { listFunding } from "../src/commands/funding/list.js";
import { useTempHome } from "./helpers.js";

const terms = {
  fingerprint: requestFingerprint({ method: "GET", url: "https://api.example.com/a", body: "" }),
  requirementKey: '["x402","exact","charge","eip155:8453","0xusdc","100000",null,null]',
  tempoChainId: 4217,
  destination: { chainId: 8453, name: "base" },
  payer: "0x00000000000000000000000000000000000000B2",
  source: "0x00000000000000000000000000000000000000a1",
  url: "https://api.example.com/a",
};

describe("funding attempts", () => {
  it("fingerprints the method, URL, and body", () => {
    const base = { method: "POST", url: "https://api.example.com/a", body: "{}" };
    expect(requestFingerprint(base)).toBe(requestFingerprint({ ...base, method: "post" }));
    for (const change of [{ method: "PUT" }, { url: "https://api.example.com/b" }, { body: "{ }" }])
      expect(requestFingerprint({ ...base, ...change })).not.toBe(requestFingerprint(base));
  });

  it("reuses the attempt of the same request and payment, and only that", async () => {
    await useTempHome();
    const first = await claimAttempt(terms);
    expect(first.reused).toBe(false);
    expect(await claimAttempt({ ...terms, payer: terms.payer.toLowerCase() })).toMatchObject({
      attemptId: first.attemptId,
      reused: true,
    });
    for (const change of [
      { fingerprint: "other" },
      { requirementKey: "other" },
      { payer: "0x00000000000000000000000000000000000000c3" },
      { source: "0x00000000000000000000000000000000000000c3" },
    ])
      expect((await claimAttempt({ ...terms, ...change })).attemptId).not.toBe(first.attemptId);
  });

  it("shares one attempt between concurrent claims", async () => {
    await useTempHome();
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimAttempt(terms)));
    expect(new Set(claims.map((claim) => claim.attemptId)).size).toBe(1);
    expect(await listAttempts()).toHaveLength(1);
  });

  it("saves plaintext metadata only, readable only by the owner", async () => {
    await useTempHome();
    const { attemptId } = await claimAttempt(terms);
    const directory = join(fundingDirectory(), "attempts");
    const [name] = (await readdir(directory)).filter((entry) => entry.endsWith(".json"));
    const path = join(directory, name!);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(await readFile(path, "utf8"))).sort()).toEqual(
      [
        "attemptId",
        "createdAt",
        "destination",
        "fingerprint",
        "payer",
        "requirementKey",
        "source",
        "tempoChainId",
        "url",
      ].sort(),
    );
    expect(await loadAttempt(attemptId)).toMatchObject(terms);
    await removeAttempt(attemptId);
    await removeAttempt(attemptId);
    expect(await loadAttempt(attemptId)).toBeUndefined();
  });
});

describe("funding commands", () => {
  it("lists an attempt that never started, and recover forgets it", async () => {
    await useTempHome();
    const { attemptId } = await claimAttempt(terms);

    expect(await listFunding("mainnet")).toMatchObject({
      chain_id: 4217,
      total: 1,
      operations: [{ id: attemptId, status: "not_started", destination: "base", reference: null }],
    });
    expect(await recoverFunding(attemptId, "mainnet")).toMatchObject({
      id: attemptId,
      status: "not_started",
    });
    expect(await listFunding("mainnet")).toMatchObject({ total: 0 });
  });

  it("refuses to recover an unknown operation", async () => {
    await useTempHome();
    await expect(recoverFunding("nope", "mainnet")).rejects.toMatchObject({
      code: "E_NOT_FOUND",
      exitCode: 2,
    });
  });
});
