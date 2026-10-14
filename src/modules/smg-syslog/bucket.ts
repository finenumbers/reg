/**
 * 10-minute folders from arrival time plus the display-zone offset.
 * The curated zones have no DST, so a fixed hour offset matches the UI clock.
 */

export type SyslogBucket = {
  year: string;
  month: string;
  day: string;
  hour: string;
  /** 00, 10, 20, 30, 40, or 50. */
  slot: string;
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function bucketOf(date: Date, offsetHours: number): SyslogBucket {
  const shifted = new Date(date.getTime() + offsetHours * 3_600_000);
  const minute = shifted.getUTCMinutes();
  const slot = Math.floor(minute / 10) * 10;
  return {
    year: String(shifted.getUTCFullYear()),
    month: pad(shifted.getUTCMonth() + 1),
    day: pad(shifted.getUTCDate()),
    hour: pad(shifted.getUTCHours()),
    slot: pad(slot),
  };
}

export function bucketKey(bucket: SyslogBucket): string {
  return `${bucket.year}/${bucket.month}/${bucket.day}/${bucket.hour}/${bucket.slot}`;
}

export function isPastBucket(fileKey: string, now: Date, offsetHours: number): boolean {
  return fileKey < bucketKey(bucketOf(now, offsetHours));
}
