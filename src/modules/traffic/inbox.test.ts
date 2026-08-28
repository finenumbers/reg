import { describe, expect, it } from "vitest";
import { inboxFileError, isInboxDataFile } from "@/modules/traffic/inbox";
import { CDR_MAX_FILE_BYTES } from "@/modules/traffic/columns";
import { POISON_FILENAME } from "@/modules/traffic/paths";

describe("inbox helpers", () => {
  it("skips dotfiles and poison store", () => {
    expect(isInboxDataFile(".hidden")).toBe(false);
    expect(isInboxDataFile(POISON_FILENAME)).toBe(false);
    expect(isInboxDataFile("20260827_200419")).toBe(true);
  });

  it("rejects empty and oversized files", () => {
    expect(
      inboxFileError({
        filename: "a",
        absPath: "/a",
        size: 0,
        mtimeMs: 1,
      }),
    ).toMatch(/пустой/);
    expect(
      inboxFileError({
        filename: "b",
        absPath: "/b",
        size: CDR_MAX_FILE_BYTES + 1,
        mtimeMs: 1,
      }),
    ).toMatch(/большой/);
    expect(
      inboxFileError({
        filename: "c",
        absPath: "/c",
        size: 10,
        mtimeMs: 1,
      }),
    ).toBeNull();
  });
});
