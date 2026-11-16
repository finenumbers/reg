import { describe, expect, it } from "vitest";
import {
  auroraEndpointLabel,
  auroraOperatorError,
  canonicalizeAuroraUrl,
  isGlobalAddress,
} from "@/modules/aurora/url";

describe("Aurora link address", () => {
  it("keeps an https address and drops the fragment", () => {
    const parsed = canonicalizeAuroraUrl(" HTTPS://Files.Example.com/a.csv?sig=secret ");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.host).toBe("files.example.com");
    expect(parsed.port).toBe("");
    expect(parsed.href).toBe("https://files.example.com/a.csv?sig=secret");
  });

  it("keeps an http address and its port", () => {
    const parsed = canonicalizeAuroraUrl(
      " HTTP://Bill.Example:8080/bgbilling/numbers/MSK.csv ",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.host).toBe("bill.example");
    expect(parsed.port).toBe("8080");
    expect(parsed.href).toBe("http://bill.example:8080/bgbilling/numbers/MSK.csv");
    const again = canonicalizeAuroraUrl(parsed.href);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.href).toBe(parsed.href);
  });

  it("treats a default port as the same address", () => {
    const plain = canonicalizeAuroraUrl("http://files.example.com/a.csv");
    const port80 = canonicalizeAuroraUrl("http://files.example.com:80/a.csv");
    const tls = canonicalizeAuroraUrl("https://files.example.com:443/a.csv");
    expect(plain.ok && port80.ok && tls.ok).toBe(true);
    if (!plain.ok || !port80.ok || !tls.ok) return;
    expect(plain.href).toBe(port80.href);
    expect(plain.port).toBe("");
    expect(tls.href).toBe("https://files.example.com/a.csv");
    expect(tls.port).toBe("");
    const explicit = canonicalizeAuroraUrl("http://files.example.com:8080/a.csv");
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.href).not.toBe(plain.href);
  });

  it("rejects a non-public target", () => {
    for (const raw of [
      "ftp://files.example.com/a.csv",
      "http://user:secret@files.example.com/a.csv",
      "https://user:secret@files.example.com/a.csv",
      "http://files.example.com/a.csv#part",
      "https://files.example.com/a.csv#part",
      "http://localhost:8080/a.csv",
      "https://localhost/a.csv",
      "https://printer.local/a.csv",
      "http://127.0.0.1:8080/a.csv",
      "https://127.0.0.1/a.csv",
      "http://10.1.1.1/a.csv",
      "https://10.1.1.1/a.csv",
      "https://169.254.169.254/latest",
      "http://2130706433:8080/a.csv",
      "https://2130706433/a.csv",
      "http://[::1]:8080/a.csv",
      "https://[::1]/a.csv",
    ]) {
      expect(canonicalizeAuroraUrl(raw).ok, raw).toBe(false);
    }
    expect(isGlobalAddress("8.8.8.8")).toBe(true);
    expect(isGlobalAddress("10.1.1.1")).toBe(false);
    expect(isGlobalAddress("::ffff:127.0.0.1")).toBe(false);
  });

  it("shows a non-default port and does not repeat an address", () => {
    expect(auroraEndpointLabel("files.example.com", "")).toBe("files.example.com");
    expect(auroraEndpointLabel("files.example.com", "8080")).toBe(
      "files.example.com:8080",
    );
    expect(auroraEndpointLabel("2001:db8::1", "8080")).toBe("[2001:db8::1]:8080");
    const text = auroraOperatorError(
      0,
      auroraEndpointLabel("files.example.com", "8080"),
      "fetch failed http://files.example.com:8080/a.csv?sig=secret",
    );
    expect(text).toBe("Ссылка 1 (files.example.com:8080): fetch failed");
    expect(text).not.toContain("sig=");
    expect(text).not.toContain("://");
  });
});
