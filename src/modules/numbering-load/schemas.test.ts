import { describe, expect, it } from "vitest";
import { sipoutKeySaveSchema } from "@/modules/numbering-load/schemas";

const SECRET = "super-secret-token";

describe("sipout key save", () => {
  it("accepts an empty body and a token, and rejects an extra field", () => {
    expect(sipoutKeySaveSchema.parse({})).toEqual({});
    expect(sipoutKeySaveSchema.parse({ token: "" })).toEqual({ token: "" });
    expect(sipoutKeySaveSchema.parse({ token: SECRET })).toEqual({ token: SECRET });
    const parsed = sipoutKeySaveSchema.safeParse({ token: SECRET, source: "free" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(JSON.stringify(parsed.error.issues)).not.toContain(SECRET);
  });
});
