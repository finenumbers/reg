import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiPermission = vi.fn();
const openPoisonedInboxFile = vi.fn();

vi.mock("@/modules/auth/guards", () => ({
  requireApiPermission: (...args: unknown[]) => requireApiPermission(...args),
}));

vi.mock("@/modules/traffic/inbox", () => ({
  openPoisonedInboxFile: (...args: unknown[]) => openPoisonedInboxFile(...args),
}));

import { GET } from "@/app/api/traffic/inbox/[filename]/route";

const filename = "20261012_063807";

function call(name: string) {
  return GET(new Request(`http://localhost/api/traffic/inbox/${name}`), {
    params: Promise.resolve({ filename: name }),
  });
}

describe("GET /api/traffic/inbox/[filename]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the guard response", async () => {
    requireApiPermission.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await call(filename);
    expect(res.status).toBe(401);
    expect(openPoisonedInboxFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the dump is not a held inbox file", async () => {
    requireApiPermission.mockResolvedValue({ ok: true, ctx: {} });
    openPoisonedInboxFile.mockResolvedValue(null);
    const res = await call("../secret");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Файл не найден");
    expect(openPoisonedInboxFile).toHaveBeenCalledWith("../secret");
  });

  it("streams the file the helper opened", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cdr-download-"));
    const absPath = path.join(dir, filename);
    const body = "cdr-line\n";
    await writeFile(absPath, body, "utf8");
    try {
      requireApiPermission.mockResolvedValue({ ok: true, ctx: {} });
      openPoisonedInboxFile.mockResolvedValue({
        filename,
        absPath,
        size: Buffer.byteLength(body),
      });
      const res = await call(filename);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toBe(
        `attachment; filename="${filename}"`,
      );
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.text()).toBe(body);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
