import { describe, expect, it } from "vitest";
import { checkSameOrigin } from "@/lib/csrf";

describe("checkSameOrigin", () => {
  it("allows GET without Origin", () => {
    const req = new Request("http://localhost:3000/api/jobs", { method: "GET" });
    expect(checkSameOrigin(req).ok).toBe(true);
  });

  it("rejects mutating request without Origin/Referer", () => {
    const req = new Request("http://localhost:3000/api/regs/poll", {
      method: "POST",
    });
    const result = checkSameOrigin(req);
    expect(result.ok).toBe(false);
  });

  it("allows matching Origin", () => {
    const req = new Request("http://localhost:3000/api/regs/poll", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(checkSameOrigin(req).ok).toBe(true);
  });

  it("allows matching Referer when Origin missing", () => {
    const req = new Request("http://localhost:3000/api/settings", {
      method: "PUT",
      headers: { Referer: "http://localhost:3000/settings" },
    });
    expect(checkSameOrigin(req).ok).toBe(true);
  });

  it("rejects mismatched Origin", () => {
    const req = new Request("http://localhost:3000/api/regs/poll", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    const result = checkSameOrigin(req);
    expect(result.ok).toBe(false);
  });

  it("does not widen allowlist via forged X-Forwarded-Host", () => {
    const prev = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = "https://reg.example";
    try {
      const req = new Request("http://127.0.0.1:3000/api/regs/poll", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "https",
        },
      });
      expect(checkSameOrigin(req).ok).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = prev;
    }
  });
});
