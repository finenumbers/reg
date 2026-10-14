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
 * Red only after a scan that found neither a ready nor a young RTU file.
 * A job that finished with no file must not stamp: that also happens while
 * a dump is still younger than the settle window.
 */
export function shouldStampRtuEmptyScan(ready: number, young: number): boolean {
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
