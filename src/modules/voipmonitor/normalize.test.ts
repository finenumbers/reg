import { describe, expect, it } from "vitest";
import {
  callIdQueryVariants,
  normalizeCallId,
} from "@/modules/voipmonitor/normalize";

describe("normalizeCallId", () => {
  it("lowercases and strips @host", () => {
    expect(normalizeCallId(" AbC@host.example ")).toBe("abc");
  });
});

describe("callIdQueryVariants", () => {
  it("keeps raw first", () => {
    const variants = callIdQueryVariants("Sip-ABC@host");
    expect(variants[0]).toBe("Sip-ABC@host");
    expect(variants.length).toBeGreaterThanOrEqual(2);
  });
});
