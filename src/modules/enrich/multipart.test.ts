import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EnrichUploadError,
  streamMultipartFileToDisk,
} from "@/modules/enrich/multipart";

const BOUNDARY = "----RegTestBoundary";

function multipartRequest(fileBody: string, opts?: { close?: boolean }): Request {
  const close = opts?.close !== false;
  const head =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="cdr.csv"\r\n` +
    `Content-Type: text/csv\r\n` +
    `\r\n`;
  const tail = close ? `\r\n--${BOUNDARY}--\r\n` : "";
  const raw = head + fileBody + tail;
  return new Request("http://localhost/api/enrich", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
    },
    body: raw,
  });
}

describe("streamMultipartFileToDisk", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("writes a complete part and requires the closing boundary", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "enrich-mp-"));
    const dest = path.join(dir, "source.csv");
    const csv = '"2026-08-01 00:00:19";"1";"2";"3";"a";"b";"c";"d";"1.1.1.1:1";"2.2.2.2:2"\n';
    const uploaded = await streamMultipartFileToDisk(
      multipartRequest(csv),
      dest,
    );
    expect(uploaded.filename).toBe("cdr.csv");
    expect(await readFile(dest, "utf8")).toBe(csv);
  });

  it("rejects a truncated body without a terminator", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "enrich-mp-"));
    const dest = path.join(dir, "source.csv");
    await expect(
      streamMultipartFileToDisk(multipartRequest("partial-line", { close: false }), dest),
    ).rejects.toMatchObject({
      name: "EnrichUploadError",
      code: "INCOMPLETE_UPLOAD",
      status: 400,
    });
    expect(EnrichUploadError).toBeDefined();
  });
});
