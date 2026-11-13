import { describe, expect, it } from "vitest";
import { oprsCalltraceToken, oprsGuiHost, oprsUrlHost } from "@/modules/oprs/calltrace";

function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

describe("oprs calltrace host", () => {
  it("matches URL.host for scheme, userinfo, case, and the default port", () => {
    const samples = [
      "https://User:pass@Example.COM:443/path?q=1#x",
      "http://Example.COM:80/a",
      "https://example.com:8443/a",
      "https://user@host.example/cdr",
      "http://a:b@Host.Example:80/x",
    ];
    for (const url of samples) {
      expect(oprsUrlHost(url)).toBe(hostOf(url));
    }
    expect(oprsUrlHost("http://a:b@c@Host.Example:80/x")).toBe("host.example");
    expect(oprsUrlHost("javascript:alert(1)")).toBe("");
    expect(oprsUrlHost("ftp://example.com/file")).toBe("");
    expect(oprsUrlHost("")).toBe("");
    expect(oprsGuiHost(" https://Gui.Example:443/app ")).toBe("gui.example");
    expect(oprsGuiHost("javascript:alert(1)")).toBe("");
  });

  it("shows the id on the screen, or открыть when the safe link has no id", () => {
    const gui = "https://gui.example";
    const url = "https://GUI.example:443/call?id=1";
    expect(oprsCalltraceToken(url, " 42 ", gui)).toBe("42");
    expect(oprsCalltraceToken(url, "  ", gui)).toBe("открыть");
    expect(oprsCalltraceToken("javascript:alert(1)", "42", gui)).toBe("");
    expect(oprsCalltraceToken(url, "42", "")).toBe("");
    expect(oprsCalltraceToken("", "42", gui)).toBe("");
  });
});
