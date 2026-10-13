import { describe, expect, it } from "vitest";

import { paymentError, paymentOutcomeUnknownError } from "../src/shared/errors.js";
import { sanitizeJson, sanitizeText } from "../src/shared/utils.js";

describe("sanitizeText", () => {
  it.each([
    { name: "CSI colors", input: "\u001b[31mred\u001b[0m text", expected: "red text" },
    {
      name: "CSI cursor movement and erase",
      input: "safe\u001b[2K\u001b[1A\u001b[2J\u001b[Hfake",
      expected: "safefake",
    },
    { name: "CSI private modes", input: "\u001b[?25lhidden cursor", expected: "hidden cursor" },
    { name: "8-bit CSI", input: "\u009b31mred", expected: "red" },
    {
      name: "OSC 8 hyperlinks",
      input: "\u001b]8;;https://evil.example\u0007docs\u001b]8;;\u0007",
      expected: "docs",
    },
    { name: "ST-terminated OSC", input: "\u001b]0;pwned\u001b\\title", expected: "title" },
    { name: "8-bit OSC", input: "\u009d0;pwned\u009ctitle", expected: "title" },
    { name: "unterminated OSC", input: "ok\u001b]52;c;Y29weQ==", expected: "ok" },
    { name: "DCS strings", input: "\u001bPq#0;2;0;0;0\u001b\\after", expected: "after" },
    { name: "other ESC sequences", input: "\u001b7a\u001b8\u001b(Bb\u001bc", expected: "ab" },
    { name: "lone ESC", input: "end\u001b", expected: "end" },
    {
      name: "C0 controls",
      input: "a\u0000b\u0007c\u0008d\re\u000bf\u000cg",
      expected: "abcdefg",
    },
    { name: "DEL and C1 controls", input: "a\u007fb\u0085c\u009cd", expected: "abcd" },
    {
      name: "bidi embeddings and overrides",
      input: "\u202aa\u202bb\u202cc\u202dd\u202ee",
      expected: "abcde",
    },
    { name: "bidi isolates", input: "\u2066a\u2067b\u2068c\u2069", expected: "abc" },
    { name: "bidi marks", input: "a\u200eb\u200fc\u061cd", expected: "abcd" },
    {
      name: "zero-width characters",
      input: "a\u200bb\u200cc\u200dd\u2060e\ufefff",
      expected: "abcdef",
    },
    { name: "tag characters", input: "ok\u{e0049}\u{e0067}\u{e006e}", expected: "ok" },
    { name: "newlines and tabs", input: "line 1\n\tline 2\n", expected: "line 1\n\tline 2\n" },
    { name: "emoji", input: "Weather 🌤️ 👍🏽", expected: "Weather 🌤️ 👍🏽" },
    {
      name: "accents",
      input: "Café naïve façade Ångström",
      expected: "Café naïve façade Ångström",
    },
    { name: "CJK", input: "天气 日本語 한국어", expected: "天气 日本語 한국어" },
    { name: "RTL scripts", input: "مرحبا שלום", expected: "مرحبا שלום" },
  ])("handles $name", ({ input, expected }) => {
    expect(sanitizeText(input)).toBe(expected);
  });
});

describe("sanitizeJson", () => {
  it.each([
    { name: "strings", input: "\u001b[1mbold\u001b[0m", expected: "bold" },
    { name: "scalars", input: [1, true, null], expected: [1, true, null] },
    {
      name: "nested values and keys",
      input: { "na\u200bme": "a\u202eb", list: [{ deep: "x\u0007y" }], count: 2 },
      expected: { name: "ab", list: [{ deep: "xy" }], count: 2 },
    },
  ])("sanitizes $name", ({ input, expected }) => {
    expect(sanitizeJson(input)).toEqual(expected);
  });
});

describe("payment errors", () => {
  it.each([
    { create: paymentError, code: "E_PAYMENT" },
    { create: paymentOutcomeUnknownError, code: "E_PAYMENT_OUTCOME_UNKNOWN" },
  ])("$code strips server-supplied escapes from its message", ({ create, code }) => {
    expect(create("failed: \u001b[2J\u202ebad\nretry")).toMatchObject({
      code,
      message: "failed: bad\nretry",
    });
  });
});
