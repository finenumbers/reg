/**
 * 10-minute folders. Syslog reception always passes offset 0, so the folders
 * are UTC. The offset argument remains for the calendar math.
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

/** True when a UTC slot key is strictly before the slot that contains `now`. */
export function isPastBucket(fileKey: string, now: Date): boolean {
  return fileKey < bucketKey(bucketOf(now, 0));
}

/** `ip/year/month/day/hour/slot` for one source at one UTC arrival. */
export function syslogFileKey(ip: string, at: Date): string {
  return `${ip}/${bucketKey(bucketOf(at, 0))}`;
}
