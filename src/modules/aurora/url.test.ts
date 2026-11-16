import { describe, expect, it } from "vitest";
import { auroraOperatorError, canonicalizeAuroraUrl, isGlobalAddress } from "@/modules/aurora/url";

describe("Aurora link address", () => {
  it("keeps an https address and drops the fragment", () => {
    const parsed = canonicalizeAuroraUrl(" HTTPS://Files.Example.com/a.csv?sig=secret ");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.host).toBe("files.example.com");
    expect(parsed.href).toBe("https://files.example.com/a.csv?sig=secret");
  });

  it("rejects a non-public target", () => {
    for (const raw of [
      "http://files.example.com/a.csv",
      "https://user:secret@files.example.com/a.csv",
      "https://files.example.com/a.csv#part",
      "https://localhost/a.csv",
      "https://printer.local/a.csv",
      "https://127.0.0.1/a.csv",
      "https://10.1.1.1/a.csv",
      "https://169.254.169.254/latest",
      "https://2130706433/a.csv",
      "https://[::1]/a.csv",
    ]) {
      expect(canonicalizeAuroraUrl(raw).ok, raw).toBe(false);
    }
    expect(isGlobalAddress("8.8.8.8")).toBe(true);
    expect(isGlobalAddress("10.1.1.1")).toBe(false);
    expect(isGlobalAddress("::ffff:127.0.0.1")).toBe(false);
  });

  it("does not repeat an address that arrived inside an error", () => {
    const text = auroraOperatorError(
      0,
      "files.example.com",
      "fetch failed https://files.example.com/a.csv?sig=secret",
    );
    expect(text).toBe("Ссылка 1 (files.example.com): fetch failed");
    expect(text).not.toContain("sig=");
    expect(text).not.toContain("://");
  });
});
