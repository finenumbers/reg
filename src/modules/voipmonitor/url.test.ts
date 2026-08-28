import { describe, expect, it } from "vitest";
import {
  buildCardUrl,
  isSafeVoipmonitorHref,
  rewriteLegacyCardUrl,
} from "@/modules/voipmonitor/url";

describe("buildCardUrl", () => {
  it("uses official fcallid and never fId", () => {
    const got = buildCardUrl("", "https://vm.example", { callId: `a"b` });
    const want = `https://vm.example/admin.php?cdr_filter=${encodeURIComponent(`{fcallid:"a\\"b"}`)}`;
    expect(got).toBe(want);
    expect(got).not.toContain("fId");
  });

  it("encodes a simple call id", () => {
    const got = buildCardUrl("", "https://vm.example", { callId: "abc" });
    expect(got).toBe(
      `https://vm.example/admin.php?cdr_filter=${encodeURIComponent(`{fcallid:"abc"}`)}`,
    );
  });

  it("adds date bounds when callDate is set", () => {
    const got = buildCardUrl("", "https://vm.example", {
      callId: "abc",
      callDate: new Date("2026-07-27T12:00:00Z"),
    });
    const decoded = decodeURIComponent(got.split("cdr_filter=")[1] ?? "");
    expect(decoded).toContain("fdatefrom");
    expect(decoded).toContain("2026-07-26T12:00:00");
    expect(decoded).toContain("2026-07-28T12:00:00");
  });
});

describe("rewriteLegacyCardUrl", () => {
  it("rewrites undocumented fId filters", () => {
    const legacy = `https://vm.example/admin.php?cdr_filter=${encodeURIComponent("{fId:42}")}`;
    const got = rewriteLegacyCardUrl(legacy, "", "sip-abc", null);
    expect(got).not.toContain("fId");
    expect(got).toContain("fcallid");
    expect(got).toContain("sip-abc");
  });
});

describe("isSafeVoipmonitorHref", () => {
  it("allows only http(s) on the configured host", () => {
    expect(
      isSafeVoipmonitorHref(
        "https://vm.example/admin.php?cdr_filter=x",
        "https://vm.example",
      ),
    ).toBe(true);
    expect(
      isSafeVoipmonitorHref("https://evil.example/x", "https://vm.example"),
    ).toBe(false);
    expect(isSafeVoipmonitorHref("javascript:alert(1)", "https://vm.example")).toBe(
      false,
    );
  });
});
