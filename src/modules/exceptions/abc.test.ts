import { describe, expect, it } from "vitest";
import { parseDialExceptionAbc } from "@/modules/exceptions/abc";

describe("parseDialExceptionAbc", () => {
  it("keeps a digit ABC, including a leading zero", () => {
    expect(parseDialExceptionAbc("0")).toBe("0");
    expect(parseDialExceptionAbc(" 00 ")).toBe("00");
    expect(parseDialExceptionAbc("887")).toBe("887");
    expect(parseDialExceptionAbc("1".repeat(15))).toBe("1".repeat(15));
  });

  it("rejects an empty value, letters, symbols, and a 16-digit code", () => {
    expect(parseDialExceptionAbc("")).toBeNull();
    expect(parseDialExceptionAbc("  ")).toBeNull();
    expect(parseDialExceptionAbc("*")).toBeNull();
    expect(parseDialExceptionAbc("#100")).toBeNull();
    expect(parseDialExceptionAbc("8a")).toBeNull();
    expect(parseDialExceptionAbc("8 3")).toBeNull();
    expect(parseDialExceptionAbc("1".repeat(16))).toBeNull();
    expect(parseDialExceptionAbc(83)).toBeNull();
  });
});
