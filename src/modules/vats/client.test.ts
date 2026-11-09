import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { getDomain, getDomains, putDomainField, type BossDeps } from "@/modules/vats/client";

const password = "pw-secret-not-for-logs";
const auth = {
  origin: "https://platform.example",
  login: "boss-user",
  password,
};

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function listen(
  onRequest: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<number> {
  const server = createServer(onRequest);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      closers.push(
        () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      );
      resolve(address.port);
    });
  });
}

function forward(port: number): { deps: BossDeps; seen: string[] } {
  const seen: string[] = [];
  const real = globalThis.fetch;
  const deps: BossDeps = {
    fetchImpl: (input, init) => {
      const url = new URL(String(input));
      seen.push(url.href);
      const headers = new Headers(init?.headers);
      return real(`http://127.0.0.1:${port}${url.pathname}`, {
        method: init?.method,
        headers,
        body: init?.body ?? undefined,
        redirect: init?.redirect,
        signal: init?.signal,
      });
    },
  };
  return { deps, seen };
}

describe("VATS Boss client", () => {
  it("reads the domain list once the platform answers, without the secret in the result", async () => {
    let calls = 0;
    const port = await listen((req, res) => {
      calls += 1;
      expect(req.method).toBe("GET");
      expect(req.url).toBe("/sys/boss/v1/domains");
      const header = req.headers.authorization ?? "";
      expect(Buffer.from(header.replace("Basic ", ""), "base64").toString("utf8")).toBe(
        `boss-user:${password}`,
      );
      if (calls === 1) {
        res.writeHead(500);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('["domain.pbx.com"]');
    });
    const { deps, seen } = forward(port);
    const logs: string[] = [];
    const write = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const result = await getDomains(auth, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(["domain.pbx.com"]);
      expect(calls).toBe(2);
      expect(seen).toEqual([
        "https://platform.example/sys/boss/v1/domains",
        "https://platform.example/sys/boss/v1/domains",
      ]);
      expect(JSON.stringify(result)).not.toContain(password);
      expect(logs.join("\n")).not.toContain(password);
    } finally {
      console.error = write;
    }
  });

  it("does not follow a redirect to another host", async () => {
    let otherHits = 0;
    const other = await listen((_req, res) => {
      otherHits += 1;
      res.writeHead(200);
      res.end("taken");
    });
    const port = await listen((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${other}/collected` });
      res.end();
    });
    const { deps, seen } = forward(port);
    const result = await getDomains(auth, deps);
    expect(result.ok).toBe(false);
    expect(otherHits).toBe(0);
    expect(seen.every((href) => href.startsWith("https://platform.example/"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(password);
    if (!result.ok) expect(result.error).not.toContain("127.0.0.1");
  });

  it("puts one field once and does not retry a failure", async () => {
    let calls = 0;
    let body = "";
    const port = await listen((req, res) => {
      calls += 1;
      expect(req.method).toBe("PUT");
      expect(req.url).toBe("/sys/boss/v1/domains/domain.pbx.com");
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8");
        res.writeHead(500);
        res.end(`no ${password}`);
      });
    });
    const { deps } = forward(port);
    const result = await putDomainField(auth, "domain.pbx.com", "client", "Acme", deps);
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(body).toBe('{"client":"Acme"}');
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain("Acme");
  });

  it("does not call the platform for a domain path it refuses", async () => {
    const result = await getDomain(auth, "../etc", {
      fetchImpl: () => {
        throw new Error("called");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Недопустимое имя домена.");
  });
});
