import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (request: NextRequest) =>
    request.cookies.get("session")?.value ?? null,
}));

import { middleware } from "@/middleware";

function makeRequest(path: string, hasSession = false) {
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();
  if (hasSession) {
    headers.set("cookie", "session=test-session");
  }
  return new NextRequest(url, { headers });
}

describe("middleware protected routes", () => {
  it("redirects anonymous users from /regs to /login", () => {
    const res = middleware(makeRequest("/regs"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Fregs");
  });

  it("redirects anonymous users from /settings to /login", () => {
    const res = middleware(makeRequest("/settings"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("returns 401 JSON for anonymous /api/regs", async () => {
    const res = middleware(makeRequest("/api/regs"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("allows Better Auth public API without session", () => {
    const res = middleware(makeRequest("/api/auth/sign-in/username"));
    expect(res.status).toBe(200);
  });

  it("allows anonymous /login", () => {
    const res = middleware(makeRequest("/login"));
    expect(res.status).toBe(200);
  });

  it("redirects authenticated users away from /login", () => {
    const res = middleware(makeRequest("/login", true));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});
