import { describe, expect, it } from "vitest";
import {
  DEFAULT_DID_BASE_URL,
  SAME_HOST_DID_BASE_URL,
  didApiUrl,
  escapeIlike,
  normalizeDidBaseUrl,
  resolveDidBaseUrl,
} from "@/modules/did/types";

describe("DID origin", () => {
  it("strips a path and keeps the docker host", () => {
    expect(normalizeDidBaseUrl("http://did-frontend:3000/free-numbers")).toBe(
      SAME_HOST_DID_BASE_URL,
    );
    expect(resolveDidBaseUrl("")).toBe(DEFAULT_DID_BASE_URL);
    expect(resolveDidBaseUrl("not a url")).toBe(DEFAULT_DID_BASE_URL);
  });

  it("rejects credentials instead of keeping them in the origin", () => {
    expect(() => normalizeDidBaseUrl("http://user:secret@did-frontend:3000")).toThrow(
      /credentials/,
    );
  });

  it("builds only the two catalog paths and leaves the token out of the URL", () => {
    const params = new URLSearchParams({ page: "1", page_size: "1" });
    const url = didApiUrl("https://did.finenumbers.com/ignored", "/numbers/free", params);
    expect(url).toBe(
      "https://did.finenumbers.com/api/backend/api/v1/numbers/free?page=1&page_size=1",
    );
    expect(url).not.toContain("secret");
    expect(didApiUrl(SAME_HOST_DID_BASE_URL, "/numbers/free/facets", new URLSearchParams())).toBe(
      "http://did-frontend:3000/api/backend/api/v1/numbers/free/facets",
    );
  });

  it("escapes ILIKE wildcards", () => {
    expect(escapeIlike("12%3_a\\b")).toBe("12\\%3\\_a\\\\b");
  });
});
