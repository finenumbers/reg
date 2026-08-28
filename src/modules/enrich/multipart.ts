/**
 * Stream a single multipart file field to disk without buffering the whole body.
 */

import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { ENRICH_MAX_UPLOAD_BYTES } from "@/modules/enrich/types";

export class EnrichUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EnrichUploadError";
  }
}

function parseBoundary(contentType: string | null): string | null {
  if (!contentType?.toLowerCase().includes("multipart/form-data")) return null;
  const match = /boundary=([^;]+)/i.exec(contentType);
  if (!match?.[1]) return null;
  return match[1].trim().replace(/^"|"$/g, "");
}

function filenameFromDisposition(header: string): string {
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  if (plain?.[1]) return plain[1];
  const bare = /filename=([^;]+)/i.exec(header);
  return bare?.[1]?.trim() || "cdr.csv";
}

export async function streamMultipartFileToDisk(
  request: Request,
  destPath: string,
  maxBytes: number = ENRICH_MAX_UPLOAD_BYTES,
): Promise<{ filename: string; bytes: number }> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    throw new EnrichUploadError(
      `Файл слишком большой (${contentLength} байт). Максимум ${maxBytes} байт`,
      413,
      "PAYLOAD_TOO_LARGE",
    );
  }

  const boundary = parseBoundary(request.headers.get("content-type"));
  if (!boundary) {
    throw new EnrichUploadError(
      "Ожидается multipart/form-data с полем file",
      400,
      "BAD_REQUEST",
    );
  }
  if (!request.body) {
    throw new EnrichUploadError("Пустое тело запроса", 400, "BAD_REQUEST");
  }

  const delim = Buffer.from(`\r\n--${boundary}`);
  const reader = request.body.getReader();
  const output = createWriteStream(destPath);
  let buf = Buffer.alloc(0);
  let inFile = false;
  let filename = "cdr.csv";
  let bytes = 0;
  let headerParsed = false;
  let sawTerminator = false;

  const writeChunk = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      output.destroy();
      throw new EnrichUploadError(
        `Файл слишком большой. Максимум ${maxBytes} байт`,
        413,
        "PAYLOAD_TOO_LARGE",
      );
    }
    if (!output.write(chunk)) {
      return new Promise<void>((resolve, reject) => {
        output.once("drain", resolve);
        output.once("error", reject);
      });
    }
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = Buffer.concat([buf, Buffer.from(value)]);

      if (!headerParsed) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        const headers = buf.subarray(0, headerEnd).toString("utf8");
        const filePart = /name="file"/i.test(headers);
        if (!filePart) {
          const next = buf.indexOf(`--${boundary}`, headerEnd + 4);
          if (next < 0) continue;
          buf = buf.subarray(next);
          continue;
        }
        filename = filenameFromDisposition(headers);
        buf = buf.subarray(headerEnd + 4);
        headerParsed = true;
        inFile = true;
      }

      if (inFile) {
        const endAt = buf.indexOf(delim);
        if (endAt >= 0) {
          await writeChunk(buf.subarray(0, endAt));
          inFile = false;
          sawTerminator = true;
          break;
        }
        const keep = delim.length;
        if (buf.length > keep) {
          await writeChunk(buf.subarray(0, buf.length - keep));
          buf = buf.subarray(buf.length - keep);
        }
      }
    }
  } finally {
    output.end();
    await finished(output).catch(() => undefined);
  }

  if (!headerParsed) {
    throw new EnrichUploadError(
      "Не передан файл (поле file)",
      400,
      "BAD_REQUEST",
    );
  }
  if (!sawTerminator) {
    throw new EnrichUploadError(
      "Файл оборвался при загрузке",
      400,
      "INCOMPLETE_UPLOAD",
    );
  }
  if (bytes <= 0) {
    throw new EnrichUploadError(
      "Не передан файл (поле file)",
      400,
      "BAD_REQUEST",
    );
  }

  return { filename, bytes };
}
