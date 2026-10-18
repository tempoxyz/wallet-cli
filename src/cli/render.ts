/**
 * The human view of a command's result on a terminal: objects as aligned `Label  value` blocks,
 * lists of objects as tables (or blocks when a table cannot fit the width), and the `next` and
 * `note` fields and incur's `cta` as lines after them. Labels are humanized from output keys;
 * everything else comes from the hints registered on the output schema with `displayMeta`. Each
 * function is pure in its arguments.
 *
 * Values in a block or a table's last column wrap at spaces to keep their alignment within the
 * width. Errors, notes, and `Next:` lines start at the first column and are left for the terminal
 * to wrap, so a command quoted in them copies as one line.
 */
import { z } from "incur";

/**
 * How the human view shows an output field, registered on its schema with
 * `.register(displayMeta, { ... })`. It is a registry rather than `.meta()`, which incur would
 * copy into the JSON Schema of `--schema`, `--llms-full`, and MCP tools. Agent output ignores it.
 */
export const displayMeta = z.registry<{
  /**
   * Token units, shown with the symbol in the sibling field this names, which is shown alone only
   * when no amount shows it.
   */
  amount?: string | undefined;
  /** An address or hash, shortened to its ends (`0x20c0…0b50`). */
  address?: boolean | undefined;
  /**
   * Left out, like a raw base-unit amount that repeats a formatted one. Naming a sibling field, it
   * is left out only while that field has a value, so a raw amount shows when it has no formatted
   * form.
   */
  hidden?: boolean | string | undefined;
  /** A shell command to run next, shown as a `Next:` line after the output. */
  next?: boolean | undefined;
  /** A sentence about what to do next, shown after the output, above any `Next:` line. */
  note?: boolean | undefined;
  /** Values colored as a success (`ok`) or a failure (`error`), by value. */
  tone?: Readonly<Record<string, "ok" | "error">> | undefined;
}>();

type Display = NonNullable<ReturnType<typeof displayMeta.get>>;

export type RenderOptions = {
  /** Whether to color: dim labels, green successes, red failures. */
  color: boolean;
  /** Columns to fit; a value without spaces, such as a URL, may still run past it. */
  width: number;
};

/**
 * Options for writing to `stream`: colors when it is a terminal that takes them, as `NO_COLOR`,
 * `FORCE_COLOR`, and `TERM` say, and its width, 80 columns when unknown.
 */
export function streamOptions(stream: NodeJS.WriteStream): RenderOptions {
  return {
    color: stream.isTTY === true && stream.hasColors?.() === true,
    width: stream.columns || 80,
  };
}

/** incur's call to action: commands to run next, each with an optional description. */
export type Cta = { commands: { command: string; description?: string | undefined }[] };

export type CommandError = {
  message: string;
  fieldErrors?: { path: string; message: string }[] | undefined;
};

type Schema = z.core.$ZodType;
type Tone = "dim" | "ok" | "error";
type Cell = { text: string; tone?: Tone | undefined };
type Context = RenderOptions & { notes: string[]; next: string[] };

const gap = 2;
/** Narrowest wrapped column before a table becomes a list of blocks. */
const minWrap = 20;

/** A command's result: its data, then any note, then a `Next:` line per follow-up command. */
export function renderResult(
  data: unknown,
  schema: Schema | undefined,
  cta: Cta | undefined,
  options: RenderOptions,
) {
  const context: Context = { ...options, notes: [], next: [] };
  const body = data === undefined ? [] : renderValue(data, schema, 0, context);
  const footer = [
    ...context.notes,
    ...context.next.map((command) => nextLine(command, undefined, options)),
    ...ctaLines(cta, options),
  ];
  return [...body, ...(body.length > 0 && footer.length > 0 ? [""] : []), ...footer].join("\n");
}

/** A failed command: `Error: <message>`, each field error, then a `Next:` line per fix. */
export function renderError(error: CommandError, cta: Cta | undefined, options: RenderOptions) {
  return [
    `${paint({ text: "Error:", tone: "error" }, options)} ${error.message}`,
    ...(error.fieldErrors ?? []).map(({ path, message }) => `  ${path}: ${message}`),
    ...ctaLines(cta, options),
  ].join("\n");
}

/** `key` as a label: words split at `_`, `-`, and case changes, with acronyms in capitals. */
export function humanize(key: string) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (acronyms.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

const acronyms = new Set(["api", "cli", "id", "mcp", "mpp", "ok", "rpc", "url"]);

/** `0x20c000000000000000000000b9537d11c60e8b50` as `0x20c0…8b50`; other text as is. */
export function shorten(text: string) {
  return /^0x[0-9a-f]{12,}$/i.test(text) ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function renderValue(
  value: unknown,
  schema: Schema | undefined,
  indent: number,
  context: Context,
): string[] {
  if (isRecord(value)) return renderObject(value, matching(schema, value), indent, context);
  if (Array.isArray(value) && !isScalar(value))
    return renderList(value, elementSchema(schema), indent, context);
  const hint = schema && displayOf(schema);
  return [pad(indent) + paint(cell(value, hint, {}, schema), context)];
}

type Item =
  | { kind: "field"; label: string; cell: Cell }
  | { kind: "section"; label: string; lines: string[] };

/** Scalars as `Label  value` lines aligned on their values; objects and lists as sections. */
function renderObject(
  record: Record<string, unknown>,
  schema: Schema | undefined,
  indent: number,
  context: Context,
) {
  const items: Item[] = [];
  for (const { key, value, schema: field, hint } of visibleFields(record, schema)) {
    if (hint?.next || hint?.note) {
      if (typeof value === "string" && value)
        (hint.next ? context.next : context.notes).push(value);
      continue;
    }
    const label = humanize(key);
    if (isScalar(value))
      items.push({ kind: "field", label, cell: cell(value, hint, record, schema) });
    else {
      const lines = renderValue(value, field, indent + gap, context);
      if (lines.length > 0) items.push({ kind: "section", label, lines });
    }
  }

  const width = Math.max(
    0,
    ...items.map((item) => (item.kind === "field" ? item.label.length : 0)),
  );
  const room = context.width - indent - width - gap;
  const chunks: string[][] = [];
  items.forEach((item, index) => {
    if (item.kind === "section") {
      chunks.push([pad(indent) + item.label, ...item.lines]);
      return;
    }
    if (items[index - 1]?.kind !== "field") chunks.push([]);
    const label = paint({ text: item.label, tone: "dim" }, context);
    const value = (text: string) => paint({ ...item.cell, text }, context);
    const [first = "", ...rest] = wrap(item.cell.text, room);
    chunks
      .at(-1)!
      .push(
        pad(indent) + label + pad(width - item.label.length + gap) + value(first),
        ...rest.map((line) => pad(indent + width + gap) + value(line)),
      );
  });
  return chunks.flatMap((chunk, index) => (index > 0 ? ["", ...chunk] : chunk));
}

/** A list of flat objects as a table when one fits, otherwise each item as a block. */
function renderList(
  items: unknown[],
  schema: Schema | undefined,
  indent: number,
  context: Context,
): string[] {
  const table = items.every(isRecord) ? renderTable(items, schema, indent, context) : undefined;
  if (table) return table;
  return items.flatMap((item, index) => [
    ...(index > 0 ? [""] : []),
    ...renderValue(item, schema, indent, context),
  ]);
}

function renderTable(
  rows: Record<string, unknown>[],
  schema: Schema | undefined,
  indent: number,
  context: Context,
) {
  const columns: string[] = [];
  for (const row of rows) {
    const fields = visibleFields(row, matching(schema, row));
    if (fields.some(({ value, hint }) => !isScalar(value) || hint?.next || hint?.note))
      return undefined;
    for (const { key } of fields) if (!columns.includes(key)) columns.push(key);
  }
  if (columns.length === 0) return undefined;

  const header = columns.map((key) => ({ text: humanize(key), tone: "dim" as const }));
  const body = rows.map((row) => {
    const rowSchema = matching(schema, row);
    const shown = new Set(visibleFields(row, rowSchema).map(({ key }) => key));
    return columns.map((key) =>
      shown.has(key) ? cell(row[key], hintOf(rowSchema, key), row, rowSchema) : { text: "" },
    );
  });
  const widths = columns.map((_, index) =>
    Math.max(...[header, ...body].map((line) => line[index]!.text.length)),
  );
  // Only the last column wraps; a table that cannot leave it `minWrap` columns is a list.
  const fixed = indent + widths.slice(0, -1).reduce((sum, width) => sum + width + gap, 0);
  const last = Math.min(widths.at(-1)!, context.width - fixed);
  if (last < Math.min(widths.at(-1)!, minWrap)) return undefined;
  widths[widths.length - 1] = last;

  return [header, ...body].flatMap((line) =>
    wrap(line.at(-1)!.text, last).map((part, row) => {
      const cells = line.map((value, index) => {
        const text = index === line.length - 1 ? part : row === 0 ? value.text : "";
        const fill = index === line.length - 1 ? "" : pad(widths[index]! - text.length + gap);
        return paint({ ...value, text }, context) + fill;
      });
      return (pad(indent) + cells.join("")).trimEnd();
    }),
  );
}

/**
 * The fields shown of `record`: those not hidden, nor a unit an amount field shows with its value.
 * A unit with a value that no amount shows, because each is empty, is shown on its own.
 */
function visibleFields(record: Record<string, unknown>, schema: Schema | undefined) {
  const fields = Object.entries(record).map(([key, value]) => {
    const field = fieldSchema(schema, key);
    return { key, value, schema: field, hint: field && displayOf(field) };
  });
  const units = new Set(fields.flatMap(({ hint }) => (hint?.amount ? [hint.amount] : [])));
  const shown = new Set(
    fields.flatMap(({ value, hint }) => (hint?.amount && !isEmpty(value) ? [hint.amount] : [])),
  );
  return fields.filter(
    ({ key, value, hint }) =>
      value !== undefined &&
      !hidden(hint, record) &&
      !(units.has(key) && (shown.has(key) || isEmpty(value))),
  );
}

function hidden(hint: Display | undefined, record: Record<string, unknown>) {
  return typeof hint?.hidden === "string" ? !isEmpty(record[hint.hidden]) : hint?.hidden === true;
}

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === "";
}

/** The text of a scalar field, or of a list of scalars, with its hint applied. */
function cell(
  value: unknown,
  hint: Display | undefined,
  record: Record<string, unknown>,
  schema: Schema | undefined,
): Cell {
  if (isEmpty(value)) return { text: "-", tone: "dim" };
  if (Array.isArray(value))
    return value.length === 0
      ? { text: "none", tone: "dim" }
      : { text: value.map((item) => cell(item, hint, record, schema).text).join(", ") };
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  if (hint?.address) text = shorten(text);
  if (hint?.amount) {
    const unit = record[hint.amount];
    if (!isEmpty(unit))
      text = `${text} ${cell(unit, hintOf(schema, hint.amount), record, schema).text}`;
  }
  return { text, tone: hint?.tone?.[String(value)] };
}

function hintOf(schema: Schema | undefined, key: string) {
  const field = fieldSchema(schema, key);
  return field && displayOf(field);
}

/** The hint registered on `schema`, or on a schema it wraps (`.optional()`, `.nullable()`, ...). */
function displayOf(schema: Schema): Display | undefined {
  for (let node: Schema | undefined = schema; node; node = unwrap(node)) {
    const hint = displayMeta.get(node);
    if (hint) return hint;
  }
  return undefined;
}

/** The schema `schema` wraps, for the wrappers that keep its value's shape. */
function unwrap(schema: Schema): Schema | undefined {
  const def = schema._zod.def as { type: string; innerType?: Schema };
  return wrappers.has(def.type) ? def.innerType : undefined;
}

const wrappers = new Set(["optional", "nullable", "default", "prefault", "readonly", "catch"]);

function ctaLines(cta: Cta | undefined, options: RenderOptions) {
  return (cta?.commands ?? []).map(({ command, description }) =>
    nextLine(command, description, options),
  );
}

function nextLine(command: string, description: string | undefined, options: RenderOptions) {
  const note = description ? paint({ text: `  # ${description}`, tone: "dim" }, options) : "";
  return `${paint({ text: "Next:", tone: "dim" }, options)} ${command}${note}`;
}

const styles: Record<Tone, [string, string]> = {
  dim: ["\u001b[2m", "\u001b[22m"],
  ok: ["\u001b[32m", "\u001b[39m"],
  error: ["\u001b[31m", "\u001b[39m"],
};

function paint({ text, tone }: Cell, { color }: RenderOptions) {
  if (!color || !tone || !text.trim()) return text;
  const [open, close] = styles[tone];
  return `${open}${text}${close}`;
}

/** `text` broken at spaces into lines of at most `width`; a longer word keeps its own line. */
function wrap(text: string, width: number) {
  if (text.length <= width || width < minWrap) return [text];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line];
}

function pad(width: number) {
  return " ".repeat(width);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value shown on one line: not an object, or a list of values that are not objects. */
function isScalar(value: unknown) {
  if (Array.isArray(value)) return value.every((item) => typeof item !== "object" || item === null);
  return typeof value !== "object" || value === null;
}

/**
 * The option of a union `schema` that `record` is, so its fields take that option's hints, as a
 * sent `send` its success `status`: of the options it parses as, the one that names the most of
 * its fields, since an object option also parses a record with more fields. Otherwise `schema`.
 */
function matching(schema: Schema | undefined, record: Record<string, unknown>): Schema | undefined {
  const def = definition(schema);
  if (def?.type !== "union") return schema;
  let best: Schema | undefined;
  let named = -1;
  for (const option of def.options ?? []) {
    if (!z.safeParse(option, record).success) continue;
    const count = Object.keys(record).filter((key) => fieldSchema(option, key)).length;
    if (count > named) [best, named] = [option, count];
  }
  return best ? matching(best, record) : schema;
}

/** The schema of field `key` of the objects `schema` describes, trying each option of a union. */
function fieldSchema(schema: Schema | undefined, key: string): Schema | undefined {
  const def = definition(schema);
  if (def?.type === "object") return def.shape?.[key];
  if (def?.type === "record") return def.valueType;
  if (def?.type === "union")
    for (const option of def.options ?? []) {
      const field = fieldSchema(option, key);
      if (field) return field;
    }
  return undefined;
}

function elementSchema(schema: Schema | undefined) {
  const def = definition(schema);
  return def?.type === "array" ? def.element : undefined;
}

function definition(schema: Schema | undefined) {
  let node = schema;
  for (let inner = node && unwrap(node); inner; inner = unwrap(inner)) node = inner;
  return node?._zod.def as
    | {
        type: string;
        shape?: Record<string, Schema>;
        valueType?: Schema;
        options?: Schema[];
        element?: Schema;
      }
    | undefined;
}
