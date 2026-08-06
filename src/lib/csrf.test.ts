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
});
