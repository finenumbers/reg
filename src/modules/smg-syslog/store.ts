import {
  closeSync,
  createWriteStream,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import type { WriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { createGzip, createGunzip, type Gzip, type Gunzip } from "node:zlib";
import { bucketOf, isPastBucket, type SyslogBucket } from "@/modules/smg-syslog/bucket";
import { frameDatagram } from "@/modules/smg-syslog/frame";
import { PARTIAL_GZ_SUFFIX } from "@/modules/smg-syslog/paths";

const FILE_MODE = 0o640;
const DIR_MODE = 0o750;
const SLICE_BYTES = 256 * 1024;

export type SyslogPacket = {
  ip: string;
  payload: Buffer;
};

type GzipJob = {
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
  failed: boolean;
};

function writeFull(fd: number, buf: Buffer): void {
  let offset = 0;
  while (offset < buf.length) {
    const wrote = writeSync(fd, buf, offset, buf.length - offset);
    if (wrote <= 0) throw new Error("short write");
    offset += wrote;
  }
}

function intervalLogPath(root: string, ip: string, bucket: SyslogBucket): string {
  return path.join(root, ip, bucket.year, bucket.month, bucket.day, bucket.hour, `${bucket.slot}.log`);
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
  private needsFsync = false;
  private job: GzipJob | null = null;
  private readonly offsetHours: () => number;

  constructor(
    private readonly root: string,
    offsetHours: number | (() => number),
  ) {
    this.offsetHours = typeof offsetHours === "function" ? offsetHours : () => offsetHours;
    ensureDir(root);
  }

  dirty(): boolean {
    return this.needsFsync;
  }

  /** Write a batch, then fsync. If a previous fsync failed, only fsync. */
  commit(packets: readonly SyslogPacket[], now: Date): void {
    if (this.needsFsync) {
      this.fsyncOpen();
      this.needsFsync = false;
      this.closeStale(now);
      return;
    }
    if (packets.length === 0) return;
    this.writeAll(packets, now);
    this.needsFsync = true;
    this.fsyncOpen();
    this.needsFsync = false;
    this.closeStale(now);
  }

  close(): void {
    this.fsyncOpen();
    this.needsFsync = false;
    for (const fd of this.fds.values()) closeSync(fd);
    this.fds.clear();
    this.abortJob();
  }

  /** One slice of gzip for a closed interval. Never touches the current bucket. */
  async pumpGzipSlice(now: Date): Promise<void> {
    if (!this.job) this.job = this.takeJob(now);
    if (!this.job) return;
    if (this.job.failed) {
      this.abortJob();
      return;
    }
    const job = this.job;
    try {
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
      const key = bucketKeyFromLog(file, this.root);
      if (key && isPastBucket(key, now, this.offsetHours())) count += 1;
    }
    return count;
  }

  private writeAll(packets: readonly SyslogPacket[], now: Date): void {
    const bucket = bucketOf(now, this.offsetHours());
    const touched = new Map<number, number>();
    try {
      for (const packet of packets) {
        const framed = frameDatagram(packet.payload);
        if (!framed) continue;
        const file = intervalLogPath(this.root, packet.ip, bucket);
        ensureDir(path.dirname(file));
        const fd = this.openAppend(file);
        if (!touched.has(fd)) touched.set(fd, fstatSync(fd).size);
        writeFull(fd, framed);
      }
    } catch (error) {
      for (const [fd, size] of touched) {
        try {
          ftruncateSync(fd, size);
        } catch {
          /* the original write error is the one to surface */
        }
      }
      throw error;
    }
  }

  private openAppend(file: string): number {
    const existing = this.fds.get(file);
    if (existing != null) return existing;
    const fd = openSync(file, "a", FILE_MODE);
    this.fds.set(file, fd);
    return fd;
  }

  private fsyncOpen(): void {
    for (const fd of this.fds.values()) fsyncSync(fd);
  }

  private closeStale(now: Date): void {
    const current = intervalLogPath(this.root, "", bucketOf(now, this.offsetHours()));
    const currentSuffix = current.slice(this.root.length);
    for (const [file, fd] of this.fds) {
      const suffix = file.slice(this.root.length);
      if (suffix.endsWith(currentSuffix)) continue;
      fsyncSync(fd);
      closeSync(fd);
      this.fds.delete(file);
    }
  }

  private takeJob(now: Date): GzipJob | null {
    for (const logPath of walkLogs(this.root)) {
      if (this.fds.has(logPath)) continue;
      const key = bucketKeyFromLog(logPath, this.root);
      if (!key || !isPastBucket(key, now, this.offsetHours())) continue;
      return this.openJob(logPath);
    }
    return null;
  }

  private openJob(logPath: string): GzipJob {
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
      failed: false,
    };
    gzip.on("error", () => {
      job.failed = true;
    });
    if (gunzip) {
      gunzip.on("data", (chunk: Buffer) => {
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
      if (!ok) await once(job.gunzip, "drain");
      return;
    }
    job.gunzip.end();
    await once(job.gunzip, "end");
    closeSync(job.oldFd);
    job.oldFd = null;
    job.phase = "log";
  }

  private async pumpLog(job: GzipJob): Promise<void> {
    const buf = Buffer.allocUnsafe(SLICE_BYTES);
    const n = readSync(job.logFd, buf, 0, SLICE_BYTES, job.logOffset);
    if (n > 0) {
      job.logOffset += n;
      const ok = job.gzip.write(buf.subarray(0, n));
      if (!ok) await once(job.gzip, "drain");
      return;
    }
    job.phase = "finish";
  }

  private async finishJob(job: GzipJob): Promise<void> {
    const finished = new Promise<void>((resolve, reject) => {
      job.out.once("finish", () => resolve());
      job.out.once("error", reject);
      job.gzip.once("error", reject);
    });
    job.gzip.end();
    await finished;
    const fd = openSync(job.partialPath, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    closeSync(job.logFd);
    renameSync(job.partialPath, job.finalPath);
    unlinkSync(job.logPath);
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
    try {
      closeSync(job.logFd);
    } catch {
      /* already closed */
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

function bucketKeyFromLog(file: string, root: string): string | null {
  const relative = path.relative(root, file);
  const parts = relative.split(path.sep);
  if (parts.length !== 6) return null;
  const slot = parts[5]?.replace(/\.log$/, "");
  if (!slot) return null;
  return `${parts[1]}/${parts[2]}/${parts[3]}/${parts[4]}/${slot}`;
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
  const stack = ips.filter((name) => !name.startsWith(".")).map((name) => path.join(root, name));
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
