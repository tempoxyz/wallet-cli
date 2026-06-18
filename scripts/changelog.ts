import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Bump = "none" | "patch" | "minor" | "major";

type PackageJson = {
  version?: string;
  [key: string]: unknown;
};

type Entry = {
  file: string;
  bumps: Map<string, Bump>;
  body: string;
};

const root = resolve(import.meta.dirname, "..");
const changelogDir = join(root, ".changelog");
const changelogPath = join(root, "CHANGELOG.md");
const packageJsonPath = join(root, "package.json");
const canonicalPackage = "wallet-cli";
const allowedPackages = new Set([canonicalPackage, "tempo-wallet", "tempo-request"]);
const bumpOrder: Record<Bump, number> = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

const command = process.argv[2] ?? "help";

if (command === "validate") validate();
else if (command === "version") version();
else if (command === "notes") notes();
else {
  console.error("Usage: tsx scripts/changelog.ts <validate|version|notes>");
  process.exit(command === "help" ? 0 : 1);
}

function validate() {
  const entries = readEntries();
  for (const entry of entries) validateEntry(entry);
  console.log(`validated ${entries.length} changelog entr${entries.length === 1 ? "y" : "ies"}`);
}

function version() {
  const entries = readEntries();
  if (entries.length === 0) {
    console.log("No pending changelog entries");
    return;
  }

  for (const entry of entries) validateEntry(entry);

  const bump = combinedBump(entries);
  if (bump === "none") {
    console.log("Only none-level changelog entries found; nothing to version");
    return;
  }

  const packageJson = readPackageJson();
  const currentVersion = packageJson.version ?? "0.0.0";
  const nextVersion = bumpVersion(currentVersion, bump);
  packageJson.version = nextVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const section = releaseSection(nextVersion, entries);
  const existing = existsSync(changelogPath)
    ? readFileSync(changelogPath, "utf8")
    : "# Changelog\n";
  writeFileSync(changelogPath, insertReleaseSection(existing, section));

  for (const entry of entries) archiveEntry(entry.file);

  console.log(`Versioned ${canonicalPackage} ${currentVersion} -> ${nextVersion}`);
}

function notes() {
  const packageJson = readPackageJson();
  const version = packageJson.version;
  if (!version) throw new Error("package.json is missing version");
  const changelog = readFileSync(changelogPath, "utf8");
  process.stdout.write(releaseNotes(changelog, version));
}

function readEntries() {
  if (!existsSync(changelogDir)) return [];
  return readdirSync(changelogDir)
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort()
    .map((file) => parseEntry(join(changelogDir, file)));
}

function parseEntry(file: string): Entry {
  const raw = readFileSync(file, "utf8");
  const match = raw.match(/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n?(?<body>[\s\S]*)$/);
  if (!match?.groups) throw new Error(`${file} must start with YAML frontmatter`);

  const bumps = new Map<string, Bump>();
  for (const line of match.groups.frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const pair = trimmed.match(/^(?<name>[A-Za-z0-9._/-]+):\s*(?<bump>major|minor|patch|none)$/);
    if (!pair?.groups) throw new Error(`${file} has invalid frontmatter line: ${line}`);
    bumps.set(pair.groups.name, pair.groups.bump as Bump);
  }

  return {
    file,
    bumps,
    body: match.groups.body.trim(),
  };
}

function validateEntry(entry: Entry) {
  if (entry.bumps.size === 0)
    throw new Error(`${entry.file} must include at least one package bump`);
  for (const name of entry.bumps.keys()) {
    if (!allowedPackages.has(name)) {
      throw new Error(
        `${entry.file} references unknown package ${name}; expected one of ${Array.from(allowedPackages).join(", ")}`,
      );
    }
  }
  if (!entry.body) throw new Error(`${entry.file} must include a changelog body`);
}

function combinedBump(entries: Entry[]): Bump {
  let result: Bump = "none";
  for (const entry of entries) {
    for (const bump of entry.bumps.values()) {
      if (bumpOrder[bump] > bumpOrder[result]) result = bump;
    }
  }
  return result;
}

function bumpVersion(version: string, bump: Bump) {
  const match = version.match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/);
  if (!match?.groups) throw new Error(`unsupported semver version: ${version}`);
  let major = Number(match.groups.major);
  let minor = Number(match.groups.minor);
  let patch = Number(match.groups.patch);

  if (bump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === "minor") {
    minor += 1;
    patch = 0;
  } else if (bump === "patch") {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function releaseSection(version: string, entries: Entry[]) {
  const groups: Record<Exclude<Bump, "none">, string[]> = {
    major: [],
    minor: [],
    patch: [],
  };

  for (const entry of entries) {
    const bump = combinedBump([entry]);
    if (bump === "none") continue;
    groups[bump].push(entry.body);
  }

  const lines = [`## ${version} (${new Date().toISOString().slice(0, 10)})`, ""];
  appendGroup(lines, "Major Changes", groups.major);
  appendGroup(lines, "Minor Changes", groups.minor);
  appendGroup(lines, "Patch Changes", groups.patch);
  return `${lines.join("\n").trimEnd()}\n`;
}

function appendGroup(lines: string[], heading: string, items: string[]) {
  if (items.length === 0) return;
  lines.push(`### ${heading}`, "");
  for (const item of items) {
    const normalized = item
      .split(/\r?\n/)
      .map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`))
      .join("\n");
    lines.push(normalized);
  }
  lines.push("");
}

function insertReleaseSection(existing: string, section: string) {
  const normalized = existing.trimEnd();
  if (!normalized) return `# Changelog\n\n${section}\n`;
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "# Changelog") return `# Changelog\n\n${section}\n${normalized}\n`;
  const rest = lines.slice(1).join("\n").trimStart();
  return `# Changelog\n\n${section}\n${rest}`.trimEnd() + "\n";
}

function archiveEntry(file: string) {
  rmSync(file, { force: true });
}

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJson;
}

function releaseNotes(changelog: string, version: string) {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## ${escapeRegExp(version)}(?: \\([^)]*\\))?$`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .join("\n")
    .trimStart();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
