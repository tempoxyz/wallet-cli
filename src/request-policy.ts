import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getRecord } from "./shared/utils.js";

export type RequestSpendPolicy = {
  maxSpend?: string | undefined;
  origins?: Record<string, { maxSpend?: string | undefined }> | undefined;
};

export async function resolveRequestMaxSpend(options: {
  explicit?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  url: string;
}) {
  if (options.explicit) return options.explicit;

  const envMaxSpend = options.env?.TEMPO_MAX_SPEND ?? process.env.TEMPO_MAX_SPEND;
  if (envMaxSpend?.trim()) return envMaxSpend.trim();

  const policy = await loadRequestSpendPolicy();
  return policy.origins?.[originKey(options.url)]?.maxSpend ?? policy.maxSpend;
}

export async function saveOriginMaxSpend(url: string, maxSpend: string) {
  const policy = await loadRequestSpendPolicy();
  const origins = { ...policy.origins };
  origins[originKey(url)] = { maxSpend };
  await saveRequestSpendPolicy({ ...policy, origins });
}

export async function loadRequestSpendPolicy(): Promise<RequestSpendPolicy> {
  let text: string;
  try {
    text = await readFile(requestSpendPolicyPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }

  const record = getRecord(JSON.parse(text) as unknown);
  const origins = Object.fromEntries(
    Object.entries(getRecord(record.origins)).flatMap(([origin, value]) => {
      const item = getRecord(value);
      return typeof item.maxSpend === "string" ? [[origin, { maxSpend: item.maxSpend }]] : [];
    }),
  );

  return {
    maxSpend: typeof record.maxSpend === "string" ? record.maxSpend : undefined,
    origins: Object.keys(origins).length ? origins : undefined,
  };
}

async function saveRequestSpendPolicy(policy: RequestSpendPolicy) {
  const path = requestSpendPolicyPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(policy, null, 2)}\n`);
}

export function requestSpendPolicyPath() {
  return join(homedir(), ".tempo", "wallet", "request-policy.json");
}

function originKey(url: string) {
  return new URL(url).origin;
}
