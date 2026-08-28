import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (request: NextRequest) =>
    request.cookies.get("session")?.value ?? null,
}));

import { middleware, middlewareMatcherHits } from "@/middleware";

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

  it("redirects anonymous users from /traffic to /login", () => {
    const res = middleware(makeRequest("/traffic"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Ftraffic");
  });

  it("redirects anonymous users from /raw to /login", () => {
    const res = middleware(makeRequest("/raw"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Fraw");
  });

  it("redirects anonymous users from /geography to /login", () => {
    const res = middleware(makeRequest("/geography"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Fgeography");
  });

  it("redirects anonymous users from /operators to /login", () => {
    const res = middleware(makeRequest("/operators"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).toContain("next=%2Foperators");
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

  it("allows Bearer API key without session cookie on /api/regs", () => {
    const url = "http://localhost:3000/api/regs";
    const headers = new Headers({ authorization: "Bearer reg_testkey" });
    const res = middleware(new NextRequest(url, { headers }));
    expect(res.status).toBe(200);
  });

  it("allows X-Api-Key without session cookie on /api/phones", () => {
    const url = "http://localhost:3000/api/phones";
    const headers = new Headers({ "x-api-key": "reg_testkey" });
    const res = middleware(new NextRequest(url, { headers }));
    expect(res.status).toBe(200);
  });

  it("allows Better Auth public API without session", () => {
    const res = middleware(makeRequest("/api/auth/sign-in/username"));
    expect(res.status).toBe(200);
  });

  it("allows anonymous /login", () => {
    const res = middleware(makeRequest("/login"));
    expect(res.status).toBe(200);
  });

  it("allows session cookie holders to stay on /login", () => {
    const res = middleware(makeRequest("/login", true));
    expect(res.status).toBe(200);
  });
});

describe("middleware matcher", () => {
  it("skips /api/enrich so Next does not clone the upload body", () => {
    expect(middlewareMatcherHits("/api/enrich")).toBe(false);
    expect(middlewareMatcherHits("/api/enrich/abc/download")).toBe(false);
  });

  it("still matches the enrich page and other APIs", () => {
    expect(middlewareMatcherHits("/enrich")).toBe(true);
    expect(middlewareMatcherHits("/api/settings")).toBe(true);
  });
});

