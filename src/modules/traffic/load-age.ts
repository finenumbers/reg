/** Elapsed time since the last CDR file was taken, and the RTU color for that pass. */

export type LoadTone = "green" | "yellow" | "red";

export type FilePassCounts = {
  fileCount: number | null;
  phonesParsed: number | null;
  changesCount: number | null;
};

/** A job that took a file, including one that threw after inserting rows. */
export function isFilePassJob(job: FilePassCounts): boolean {
  if ((job.fileCount ?? 0) > 0) return true;
  if ((job.phonesParsed ?? 0) > 0) return true;
  return (job.changesCount ?? 0) > 0;
}

/** Valid call rows: newly inserted or already stored duplicates. */
export function filePassHadCalls(job: {
  phonesParsed: number | null;
  changesCount: number | null;
}): boolean {
  return (job.phonesParsed ?? 0) > 0 || (job.changesCount ?? 0) > 0;
}

/**
 * Red only after a scan that found neither a ready nor a young file.
 * A job that finished with no file must not stamp: that also happens while
 * a dump is still younger than the settle window, and when the other side's
 * upload wakes an empty import.
 */
export function shouldStampEmptyScan(ready: number, young: number): boolean {
  return ready === 0 && young === 0;
}

export function passTone(input: {
  lastPassAt: number;
  hadCalls: boolean;
  lastCheckedAt: number | null;
}): LoadTone {
  if (input.lastCheckedAt != null && input.lastCheckedAt > input.lastPassAt) {
    return "red";
  }
  return input.hadCalls ? "green" : "yellow";
}

export type LoadPass = { at: number; hadCalls: boolean };

/**
 * Clock anchor. Digits always come from a file time.
 * A yellow streak keeps the first empty file. A green file always wins.
 * `breakAt` is a later empty file that ended a red episode in this process.
 */
export function resolveLoadAnchor(input: {
  latest: LoadPass | null;
  streakStart: number | null;
  breakAt: number | null;
}): LoadPass | null {
  if (!input.latest) return null;
  if (input.latest.hadCalls) return { at: input.latest.at, hadCalls: true };
  const start = input.streakStart ?? input.latest.at;
  const breakAt = input.breakAt;
  if (breakAt != null && breakAt > start && breakAt <= input.latest.at) {
    return { at: breakAt, hadCalls: false };
  }
  return { at: start, hadCalls: false };
}

export type LoadEpisode = { anchor: number; hadCalls: boolean; brokeRed: boolean };

/**
 * Remember a file pass. A later empty file does not move a yellow episode
 * unless an empty scan newer than that episode happened first.
 */
export function nextLoadEpisode(
  episode: LoadEpisode | null,
  scanAt: number | null,
  pass: LoadPass,
): LoadEpisode {
  if (pass.hadCalls) return { anchor: pass.at, hadCalls: true, brokeRed: false };
  if (
    episode != null &&
    !episode.hadCalls &&
    (scanAt == null || scanAt <= episode.anchor)
  ) {
    return episode;
  }
  if (
    scanAt != null &&
    scanAt < pass.at &&
    (episode == null || episode.hadCalls || scanAt > episode.anchor)
  ) {
    return { anchor: pass.at, hadCalls: false, brokeRed: true };
  }
  if (episode != null && !episode.hadCalls) return episode;
  return { anchor: pass.at, hadCalls: false, brokeRed: false };
}

/** `mm:ss` under an hour, `h:mm:ss` from one hour. Negative clocks clamp to zero. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function loadAgeStateLabel(tone: LoadTone | null): string | null {
  if (tone === "green") return "в файле были звонки";
  if (tone === "yellow") return "файл без звонков";
  if (tone === "red") return "нового файла не было";
  return null;
}
