import { describe, expect, it } from "vitest";
import {
  filePassHadCalls,
  formatElapsed,
  isFilePassJob,
  nextLoadEpisode,
  passTone,
  resolveLoadAnchor,
  shouldStampEmptyScan,
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
    expect(passTone({ lastPassAt: fileAt, hadCalls: true, lastCheckedAt: fileAt })).toBe(
      "green",
    );
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

describe("resolveLoadAnchor", () => {
  const green = (at: number) => ({ at, hadCalls: true });
  const yellow = (at: number) => ({ at, hadCalls: false });

  it("keeps the first empty file of a yellow streak", () => {
    expect(
      resolveLoadAnchor({ latest: yellow(300), streakStart: 100, breakAt: null }),
    ).toEqual(yellow(100));
  });

  it("uses the latest file when it had calls", () => {
    expect(
      resolveLoadAnchor({ latest: green(500), streakStart: 100, breakAt: 400 }),
    ).toEqual(green(500));
  });

  it("starts a new yellow streak at the file that ended red", () => {
    expect(
      resolveLoadAnchor({ latest: yellow(400), streakStart: 100, breakAt: 400 }),
    ).toEqual(yellow(400));
  });

  it("ignores an empty-scan mark from before the streak", () => {
    expect(
      resolveLoadAnchor({ latest: yellow(300), streakStart: 100, breakAt: 50 }),
    ).toEqual(yellow(100));
  });

  it("returns null when no file has been taken", () => {
    expect(
      resolveLoadAnchor({ latest: null, streakStart: null, breakAt: null }),
    ).toBeNull();
  });
});

describe("nextLoadEpisode", () => {
  it("does not move a yellow episode when the next file is also empty", () => {
    const first = nextLoadEpisode(null, null, { at: 100, hadCalls: false });
    expect(nextLoadEpisode(first, null, { at: 200, hadCalls: false })).toEqual(first);
  });

  it("replaces the anchor on every file that had calls", () => {
    const first = nextLoadEpisode(null, null, { at: 100, hadCalls: true });
    expect(nextLoadEpisode(first, null, { at: 200, hadCalls: true })).toEqual({
      anchor: 200,
      hadCalls: true,
      brokeRed: false,
    });
  });

  it("starts a new yellow episode when an empty file arrives after a red scan", () => {
    const yellow = nextLoadEpisode(null, null, { at: 100, hadCalls: false });
    const afterRed = nextLoadEpisode(yellow, 150, { at: 200, hadCalls: false });
    expect(afterRed).toEqual({ anchor: 200, hadCalls: false, brokeRed: true });
    expect(nextLoadEpisode(afterRed, 150, { at: 300, hadCalls: false })).toEqual(
      afterRed,
    );
  });

  it("holds the streak when a scan is older than the current episode", () => {
    const held = nextLoadEpisode({ anchor: 100, hadCalls: false, brokeRed: true }, 50, {
      at: 200,
      hadCalls: false,
    });
    expect(held.anchor).toBe(100);
  });
});

describe("shouldStampEmptyScan", () => {
  it("stamps only when the inbox has no ready and no young file", () => {
    expect(shouldStampEmptyScan(0, 0)).toBe(true);
    expect(shouldStampEmptyScan(1, 0)).toBe(false);
    expect(shouldStampEmptyScan(0, 1)).toBe(false);
  });
});
