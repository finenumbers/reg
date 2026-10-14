import { describe, expect, it } from "vitest";
import {
  filePassHadCalls,
  formatElapsed,
  isFilePassJob,
  passTone,
  shouldStampRtuEmptyScan,
} from "@/modules/traffic/load-age";

const MINUTE = 60_000;

describe("formatElapsed", () => {
  it("clamps a negative clock to 00:00", () => {
    expect(formatElapsed(-1_500)).toBe("00:00");
  });

  it("pads minutes and seconds under an hour", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(4 * MINUTE + 7_000)).toBe("04:07");
    expect(formatElapsed(59 * MINUTE + 59_000)).toBe("59:59");
  });

  it("switches to hours at 60 minutes", () => {
    expect(formatElapsed(60 * MINUTE)).toBe("1:00:00");
    expect(formatElapsed(2 * 60 * MINUTE + 4 * MINUTE + 7_000)).toBe("2:04:07");
  });
});

describe("passTone", () => {
  const fileAt = 1_000_000;

  it("is green when the file contained calls and no later empty scan", () => {
    expect(passTone({ lastPassAt: fileAt, hadCalls: true, lastCheckedAt: null })).toBe(
      "green",
    );
    expect(
      passTone({ lastPassAt: fileAt, hadCalls: true, lastCheckedAt: fileAt }),
    ).toBe("green");
  });

  it("is yellow for a file with no call rows", () => {
    expect(passTone({ lastPassAt: fileAt, hadCalls: false, lastCheckedAt: null })).toBe(
      "yellow",
    );
  });

  it("turns red when an empty scan is newer and does not move the anchor", () => {
    expect(
      passTone({ lastPassAt: fileAt, hadCalls: true, lastCheckedAt: fileAt + 1 }),
    ).toBe("red");
  });
});

describe("file pass selection", () => {
  it("treats a re-sent dump of existing calls as a file with calls", () => {
    const job = { fileCount: 1, phonesParsed: 0, changesCount: 4 };
    expect(isFilePassJob(job)).toBe(true);
    expect(filePassHadCalls(job)).toBe(true);
  });

  it("treats an empty file as a file pass without calls", () => {
    const job = { fileCount: 1, phonesParsed: 0, changesCount: 0 };
    expect(isFilePassJob(job)).toBe(true);
    expect(filePassHadCalls(job)).toBe(false);
  });

  it("ignores a pass that took no file", () => {
    const job = { fileCount: 0, phonesParsed: 0, changesCount: 0 };
    expect(isFilePassJob(job)).toBe(false);
    expect(filePassHadCalls(job)).toBe(false);
  });

  it("keeps a thrown import that already inserted rows", () => {
    const job = { fileCount: null, phonesParsed: 3, changesCount: 0 };
    expect(isFilePassJob(job)).toBe(true);
    expect(filePassHadCalls(job)).toBe(true);
  });
});

describe("shouldStampRtuEmptyScan", () => {
  it("stamps only when the inbox has no ready and no young file", () => {
    expect(shouldStampRtuEmptyScan(0, 0)).toBe(true);
    expect(shouldStampRtuEmptyScan(1, 0)).toBe(false);
    expect(shouldStampRtuEmptyScan(0, 1)).toBe(false);
  });
});
