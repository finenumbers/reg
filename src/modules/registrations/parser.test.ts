import { describe, expect, it } from "vitest";
import {
  parseRegsLine,
  parseRegsStdout,
} from "@/modules/registrations/parser";

describe("parseRegsLine", () => {
  it("parses a Registered line with endpoint", () => {
    const result = parseRegsLine("73852222205;Registered;46.20.69.189:5060");
    expect(result).toEqual({
      ok: true,
      row: {
        phone: "73852222205",
        status: "Registered",
        ip: "46.20.69.189",
        port: 5060,
        rawLine: "73852222205;Registered;46.20.69.189:5060",
      },
    });
  });

  it("parses Unregistered with empty endpoint", () => {
    const result = parseRegsLine("73912193303;Unregistered;");
    expect(result).toEqual({
      ok: true,
      row: {
        phone: "73912193303",
        status: "Unregistered",
        ip: null,
        port: null,
        rawLine: "73912193303;Unregistered;",
      },
    });
  });

  it("parses TTY ANSI-colored Registered lines", () => {
    const colored =
      "78622606009;\u001b[32mRegistered\u001b[0m;\u001b[35m5.227.161.172:5060\u001b[0m";
    const result = parseRegsLine(colored);
    expect(result).toEqual({
      ok: true,
      row: {
        phone: "78622606009",
        status: "Registered",
        ip: "5.227.161.172",
        port: 5060,
        rawLine: "78622606009;Registered;5.227.161.172:5060",
      },
    });
  });

  it("rejects malformed lines", () => {
    expect(parseRegsLine("no-semicolons").ok).toBe(false);
    expect(parseRegsLine("phone;Unknown;1.2.3.4:5060").ok).toBe(false);
    expect(parseRegsLine(";Registered;1.2.3.4:5060").ok).toBe(false);
    expect(parseRegsLine("123;Registered;not-an-endpoint").ok).toBe(false);
    expect(parseRegsLine("123;Registered;999.1.1.1:5060").ok).toBe(false);
    expect(parseRegsLine("123;Registered;1.2.3.4:99999").ok).toBe(false);
    expect(parseRegsLine("a;b;c;d").ok).toBe(false);
  });
});

describe("parseRegsStdout", () => {
  it("parses mixed valid lines and skips bad ones", () => {
    const stdout = [
      "73852222205;Registered;46.20.69.189:5060",
      "73912193303;Unregistered;",
      "bad-line",
      "420910902600;Registered;185.175.158.149:5060",
      "",
    ].join("\n");

    const result = parseRegsStdout(stdout);
    expect(result.rows).toHaveLength(3);
    expect(result.linesBad).toBe(1);
    expect(result.duplicatePhones).toBe(0);
    expect(result.rows.map((r) => r.phone)).toEqual([
      "73852222205",
      "73912193303",
      "420910902600",
    ]);
  });

  it("keeps last duplicate phone and counts duplicates", () => {
    const stdout = [
      "100;Registered;1.1.1.1:5060",
      "100;Unregistered;",
    ].join("\n");
    const result = parseRegsStdout(stdout);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicatePhones).toBe(1);
    expect(result.rows[0]).toMatchObject({
      phone: "100",
      status: "Unregistered",
      ip: null,
      port: null,
    });
  });

  it("parses ANSI-colored stdout batch", () => {
    const stdout = [
      "78622606009;\u001b[32mRegistered\u001b[0m;\u001b[35m5.227.161.172:5060\u001b[0m",
      "73912193303;\u001b[31mUnregistered\u001b[0m;",
    ].join("\n");
    const result = parseRegsStdout(stdout);
    expect(result.linesBad).toBe(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      phone: "78622606009",
      status: "Registered",
      ip: "5.227.161.172",
      port: 5060,
    });
    expect(result.rows[1]).toMatchObject({
      phone: "73912193303",
      status: "Unregistered",
      ip: null,
      port: null,
    });
  });

  it("returns empty rows for empty stdout", () => {
    const result = parseRegsStdout("\n\n");
    expect(result.rows).toEqual([]);
    expect(result.linesTotal).toBe(0);
    expect(result.linesBad).toBe(0);
  });
});
