import {
  closeSync,
  createWriteStream,
  fstatSync,
  fsync as fsyncCallback,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  write as writeCallback,
} from "node:fs";
import type { WriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { createGzip, createGunzip, type Gzip, type Gunzip } from "node:zlib";
import { bucketOf, isPastBucket, type SyslogBucket } from "@/modules/smg-syslog/bucket";
import { frameDatagram, lineParts, syslogLineFeed } from "@/modules/smg-syslog/frame";
import { PARTIAL_GZ_SUFFIX } from "@/modules/smg-syslog/paths";

const FILE_MODE = 0o640;
const DIR_MODE = 0o750;
const SLICE_BYTES = 256 * 1024;
const GZIP_WAIT_MS = 10_000;

export type SyslogPacket = {
  ip: string;
  payload: Buffer;
  /** UTC instant the datagram was taken from the socket. */
  receivedAt: Date;
};

type GzipJob = {
  fileKey: string;
  hadOld: boolean;
  logPath: string;
  finalPath: string;
  partialPath: string;
  gzip: Gzip;
  out: WriteStream;
  phase: "prefix" | "log" | "finish";
  gunzip: Gunzip | null;
  oldFd: number | null;
  oldOffset: number;
  oldSize: number;
  logFd: number;
  logOffset: number;
  logSize: number;
  /** Last uncompressed byte of the previous archive, once any byte has been seen. */
  prefixLast: number | null;
  failed: boolean;
};

function fsyncAsync(fd: number): Promise<void> {
  return new Promise((resolve, reject) => {
    fsyncCallback(fd, (error) => (error ? reject(error) : resolve()));
  });
}

/** Append the whole buffer. A null position keeps O_APPEND; zero would overwrite. */
function writeFull(fd: number, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const step = (offset: number) => {
      writeCallback(fd, buf, offset, buf.length - offset, null, (error, written) => {
        if (error) {
          reject(error);
          return;
        }
        if (written <= 0) {
          reject(new Error("short write"));
          return;
        }
        if (offset + written >= buf.length) resolve();
        else step(offset + written);
      });
    };
    step(0);
  });
}

function intervalLogPath(root: string, ip: string, bucket: SyslogBucket): string {
  return path.join(
    root,
    ip,
    bucket.year,
    bucket.month,
    bucket.day,
    bucket.hour,
    `${bucket.slot}.log`,
  );
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
}

/**
 * Append-only raw logs for the open interval, then a single gzip member
 * once that interval is in the past. A failed write is truncated back so a
 * retry does not duplicate bytes. A failed fsync is retried without rewriting.
 */
export class SyslogStore {
  private readonly fds = new Map<string, number>();
  /** Append descriptors whose file already ends with LF. Cleared on a failed write. */
  private readonly endsWithLf = new Set<number>();
  private needsFsync = false;
  private job: GzipJob | null = null;
  private failFsync = false;
  private failWrite = false;
  private readonly gzipWaitMs: number;
  private readonly syncFile: (fd: number) => Promise<void>;

  constructor(
    private readonly root: string,
    options?: { gzipWaitMs?: number; syncFile?: (fd: number) => Promise<void> },
  ) {
    this.gzipWaitMs = options?.gzipWaitMs ?? GZIP_WAIT_MS;
    this.syncFile = options?.syncFile ?? fsyncAsync;
    ensureDir(root);
  }

  /** Next fsync throws once. The bytes already written stay on disk. */
  failNextFsync(): void {
    this.failFsync = true;
  }

  /** Next append is written, then thrown, so the batch is truncated back. */
  failNextWrite(): void {
    this.failWrite = true;
  }

  dirty(): boolean {
    return this.needsFsync;
  }

  /**
   * Write a batch by each datagram's arrival time, then fsync.
   * A failed fsync is retried before the next batch is written, so the
   * retry does not drop that batch and does not write the previous one twice.
   */
  async commit(packets: readonly SyslogPacket[]): Promise<void> {
    if (this.needsFsync) {
      await this.fsyncOpen();
      this.needsFsync = false;
    }
    if (packets.length === 0) {
      this.closeStale();
      return;
    }
    await this.writeAll(packets);
    this.needsFsync = true;
    await this.fsyncOpen();
    this.needsFsync = false;
    this.closeStale();
  }

  async close(): Promise<void> {
    if (this.needsFsync) {
      await this.fsyncOpen();
      this.needsFsync = false;
    }
    for (const fd of this.fds.values()) {
      closeSync(fd);
      this.endsWithLf.delete(fd);
    }
    this.fds.clear();
    this.abortJob();
  }

  /**
   * One slice of gzip for a closed interval.
   * `blocked` slots still have queued datagrams or an open append, so they
   * are left as raw logs. A timed-out slice deletes only the partial archive.
   */
  async pumpGzipSlice(now: Date, blocked: ReadonlySet<string>): Promise<void> {
    if (this.job && blocked.has(this.job.fileKey)) this.abortJob();
    if (!this.job) this.job = this.takeJob(now, blocked);
    if (!this.job) return;
    if (this.job.failed) {
      this.abortJob();
      return;
    }
    const job = this.job;
    try {
      if (blocked.has(job.fileKey) || this.logGrew(job)) {
        this.abortJob();
        return;
      }
      if (job.phase === "prefix") {
        await this.pumpPrefix(job);
        return;
      }
      if (job.phase === "log") {
        await this.pumpLog(job);
        return;
      }
      await this.finishJob(job);
      this.job = null;
    } catch {
      this.abortJob();
    }
  }

  countPendingRaw(now: Date): number {
    let count = 0;
    for (const file of walkLogs(this.root)) {
      const key = timeKeyFromLog(file, this.root);
      if (key && isPastBucket(key, now)) count += 1;
    }
    return count;
  }

  private async writeAll(packets: readonly SyslogPacket[]): Promise<void> {
    const chunks = new Map<number, Buffer[]>();
    const touched = new Map<number, number>();
    try {
      for (const packet of packets) {
        const framed = frameDatagram(packet.payload);
        if (!framed) continue;
        const bucket = bucketOf(packet.receivedAt, 0);
        const file = intervalLogPath(this.root, packet.ip, bucket);
        ensureDir(path.dirname(file));
        const fd = this.openAppend(file);
        if (!touched.has(fd)) {
          const size = fstatSync(fd).size;
          touched.set(fd, size);
          const parts: Buffer[] = [];
          if (this.needsLeadingBreak(fd, size)) parts.push(syslogLineFeed);
          chunks.set(fd, parts);
        }
        chunks.get(fd)?.push(...lineParts(framed));
      }
      for (const [fd, parts] of chunks) {
        if (parts.length === 0) continue;
        await writeFull(fd, Buffer.concat(parts));
        if (this.failWrite) {
          this.failWrite = false;
          throw new Error("write failed");
        }
        this.endsWithLf.add(fd);
      }
    } catch (error) {
      for (const [fd, size] of touched) {
        this.endsWithLf.delete(fd);
        try {
          ftruncateSync(fd, size);
        } catch {
          /* the original write error is the one to surface */
        }
      }
      throw error;
    }
  }

  /** One LF before this batch when the bytes already on disk do not end with one. */
  private needsLeadingBreak(fd: number, size: number): boolean {
    if (this.endsWithLf.has(fd)) return false;
    if (size === 0) return false;
    const buf = Buffer.alloc(1);
    const n = readSync(fd, buf, 0, 1, size - 1);
    if (n !== 1) throw new Error("syslog tail unreadable");
    if (buf[0] === 0x0a) {
      this.endsWithLf.add(fd);
      return false;
    }
    return true;
  }

  private openAppend(file: string): number {
    const existing = this.fds.get(file);
    if (existing != null) return existing;
    const fd = openSync(file, "a+", FILE_MODE);
    this.fds.set(file, fd);
    return fd;
  }

  private async fsyncOpen(): Promise<void> {
    if (this.failFsync) {
      this.failFsync = false;
      throw new Error("fsync failed");
    }
    for (const fd of this.fds.values()) await this.syncFile(fd);
  }

  private closeStale(): void {
    const current = intervalLogPath(this.root, "", bucketOf(new Date(), 0));
    const currentSuffix = current.slice(this.root.length);
    for (const [file, fd] of this.fds) {
      const suffix = file.slice(this.root.length);
      if (suffix.endsWith(currentSuffix)) continue;
      closeSync(fd);
      this.endsWithLf.delete(fd);
      this.fds.delete(file);
    }
  }

  private takeJob(now: Date, blocked: ReadonlySet<string>): GzipJob | null {
    for (const logPath of walkLogs(this.root)) {
      if (this.fds.has(logPath)) continue;
      const timeKey = timeKeyFromLog(logPath, this.root);
      const fileKey = fileKeyFromLog(logPath, this.root);
      if (!timeKey || !fileKey || !isPastBucket(timeKey, now)) continue;
      if (blocked.has(fileKey)) continue;
      return this.openJob(logPath, fileKey);
    }
    return null;
  }

  private openJob(logPath: string, fileKey: string): GzipJob {
    const finalPath = `${logPath}.gz`;
    const partialPath = `${logPath}.gz.partial`;
    const gzip = createGzip();
    const out = createWriteStream(partialPath, { flags: "w", mode: FILE_MODE });
    gzip.pipe(out);
    const oldExists = existsFile(finalPath);
    const oldStat = oldExists ? statSync(finalPath) : null;
    const logStat = statSync(logPath);
    const gunzip = oldExists ? createGunzip() : null;
    const job: GzipJob = {
      fileKey,
      hadOld: oldExists,
      logPath,
      finalPath,
      partialPath,
      gzip,
      out,
      phase: oldExists ? "prefix" : "log",
      gunzip,
      oldFd: oldExists ? openSync(finalPath, "r") : null,
      oldOffset: 0,
      oldSize: oldStat?.size ?? 0,
      logFd: openSync(logPath, "r"),
      logOffset: 0,
      logSize: logStat.size,
      prefixLast: null,
      failed: false,
    };
    gzip.on("error", () => {
      job.failed = true;
    });
    out.on("error", () => {
      job.failed = true;
    });
    if (gunzip) {
      gunzip.on("data", (chunk: Buffer) => {
        if (chunk.length > 0) job.prefixLast = chunk[chunk.length - 1] ?? null;
        gzip.write(chunk);
      });
      gunzip.on("error", () => {
        job.failed = true;
      });
    }
    return job;
  }

  private async pumpPrefix(job: GzipJob): Promise<void> {
    if (job.oldFd == null || !job.gunzip) {
      job.phase = "log";
      return;
    }
    const buf = Buffer.allocUnsafe(SLICE_BYTES);
    const n = readSync(job.oldFd, buf, 0, SLICE_BYTES, job.oldOffset);
    if (n > 0) {
      job.oldOffset += n;
      const ok = job.gunzip.write(buf.subarray(0, n));
      if (!ok) await this.waitFor(job.gunzip, "drain");
      return;
    }
    job.gunzip.end();
    await this.waitFor(job.gunzip, "end");
    closeSync(job.oldFd);
    job.oldFd = null;
    if (job.logSize > 0 && job.prefixLast != null && job.prefixLast !== 0x0a) {
      const ok = job.gzip.write(syslogLineFeed);
      if (!ok) await this.waitFor(job.gzip, "drain");
    }
    job.phase = "log";
  }

  private async pumpLog(job: GzipJob): Promise<void> {
    const buf = Buffer.allocUnsafe(SLICE_BYTES);
    const n = readSync(job.logFd, buf, 0, SLICE_BYTES, job.logOffset);
    if (n > 0) {
      job.logOffset += n;
      const ok = job.gzip.write(buf.subarray(0, n));
      if (!ok) await this.waitFor(job.gzip, "drain");
      return;
    }
    job.phase = "finish";
  }

  private async finishJob(job: GzipJob): Promise<void> {
    if (this.logGrew(job)) throw new Error("log grew");
    const finished = new Promise<void>((resolve, reject) => {
      job.out.once("finish", () => resolve());
      job.out.once("error", reject);
      job.gzip.once("error", reject);
    });
    job.gzip.end();
    await this.raceTimeout(finished);
    if (this.logGrew(job)) throw new Error("log grew");
    const fd = openSync(job.partialPath, "r+");
    try {
      await this.syncFile(fd);
    } finally {
      closeSync(fd);
    }
    if (this.logGrew(job)) throw new Error("log grew");
    closeSync(job.logFd);
    job.logFd = -1;
    renameSync(job.partialPath, job.finalPath);
    if (this.logGrew(job)) {
      if (!job.hadOld) {
        try {
          unlinkSync(job.finalPath);
        } catch {
          /* the raw log still has every byte */
        }
      }
      return;
    }
    unlinkSync(job.logPath);
  }

  private logGrew(job: GzipJob): boolean {
    try {
      return statSync(job.logPath).size !== job.logSize;
    } catch {
      return true;
    }
  }

  private async waitFor(emitter: Gzip | Gunzip, event: "drain" | "end"): Promise<void> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.gzipWaitMs);
    try {
      await once(emitter, event, { signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private raceTimeout(promise: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("syslog gzip timed out")),
        this.gzipWaitMs,
      );
      promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private abortJob(): void {
    const job = this.job;
    this.job = null;
    if (!job) return;
    job.failed = true;
    try {
      job.gzip.destroy();
    } catch {
      /* already closed */
    }
    try {
      job.out.destroy();
    } catch {
      /* already closed */
    }
    if (job.oldFd != null) {
      try {
        closeSync(job.oldFd);
      } catch {
        /* already closed */
      }
    }
    if (job.logFd >= 0) {
      try {
        closeSync(job.logFd);
      } catch {
        /* already closed */
      }
    }
    try {
      unlinkSync(job.partialPath);
    } catch {
      /* partial may not exist yet */
    }
  }
}

function existsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function timeKeyFromLog(file: string, root: string): string | null {
  const parts = logParts(file, root);
  if (!parts) return null;
  return `${parts[1]}/${parts[2]}/${parts[3]}/${parts[4]}/${parts[5]}`;
}

function fileKeyFromLog(file: string, root: string): string | null {
  const parts = logParts(file, root);
  if (!parts) return null;
  return parts.join("/");
}

function logParts(file: string, root: string): string[] | null {
  const relative = path.relative(root, file);
  const parts = relative.split(path.sep);
  if (parts.length !== 6) return null;
  const slot = parts[5]?.replace(/\.log$/, "");
  if (!slot) return null;
  return [
    parts[0] ?? "",
    parts[1] ?? "",
    parts[2] ?? "",
    parts[3] ?? "",
    parts[4] ?? "",
    slot,
  ];
}

function walkLogs(root: string): string[] {
  const found: string[] = [];
  let ips: string[] = [];
  try {
    ips = readdirSync(root);
  } catch {
    return found;
  }
  for (const ip of ips) {
    if (ip.startsWith(".")) continue;
    walkDir(path.join(root, ip), found);
  }
  return found;
}

function walkDir(dir: string, found: string[]): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkDir(full, found);
    else if (name.endsWith(".log") && !name.endsWith(".gz")) found.push(full);
  }
}

export function removePartialArchives(root: string): void {
  let ips: string[] = [];
  try {
    ips = readdirSync(root);
  } catch {
    return;
  }
  const stack = ips
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(root, name));
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let names: string[] = [];
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(current, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) stack.push(full);
      else if (name.endsWith(".log.gz.partial") || name.endsWith(PARTIAL_GZ_SUFFIX)) {
        try {
          unlinkSync(full);
        } catch {
          /* next start tries again */
        }
      }
    }
  }
}

/** Read a closed raw log through the store's public path helper for tests. */
