import { describe, expect, it } from "vitest";
import { isMailAddressAllowed, chooseMailAddress } from "@/modules/mail/addresses";
import { readCappedBody } from "@/modules/mail/body";
import { resolveMailHost } from "@/modules/mail/dns";
import {
  parseMailHost,
  parseMailPort,
  parseMailbox,
  parseRecipientList,
  PROBE_SUBJECT,
  probeText,
} from "@/modules/mail/fields";
import { resetMailSendSlot, tryHoldMailSend } from "@/modules/mail/hold";
import { planMailSave, readyProbe, type MailRow } from "@/modules/mail/plan";
import { runMailProbe } from "@/modules/mail/probe";
import {
  buildSmtpOptions,
  classifySmtpError,
  deliverProbe,
  type SmtpOptions,
} from "@/modules/mail/smtp";

const SECRET = "mailbox-secret-value";

function row(overrides: Partial<MailRow> = {}): MailRow {
  return {
    host: "smtp.example",
    port: 587,
    username: "ops@example.com",
    from: "ops@example.com",
    recipients: ["a@example.com"],
    passwordCiphertext: "v1:aa:bb:cc",
    ...overrides,
  };
}

describe("mail fields", () => {
  it("rejects IMAP ports and accepts the two send ports", () => {
    expect(parseMailPort(143)).toBeNull();
    expect(parseMailPort(993)).toBeNull();
    expect(parseMailPort(25)).toBeNull();
    expect(parseMailPort(465)).toBe(465);
    expect(parseMailPort(587)).toBe(587);
  });

  it("rejects a local name, a URL, and a unicode mailbox", () => {
    expect(parseMailHost("localhost").ok).toBe(false);
    expect(parseMailHost("mail.local").ok).toBe(false);
    expect(parseMailHost("https://smtp.example").ok).toBe(false);
    expect(parseMailHost("smtp.example").ok).toBe(true);
    expect(parseMailbox("ops@example.com")).toBe("ops@example.com");
    expect(parseMailbox("оператор@example.com")).toBeNull();
  });

  it("rejects a repeated recipient", () => {
    const parsed = parseRecipientList(["A@example.com", "a@example.com"]);
    expect(parsed.ok).toBe(false);
  });
});

describe("mail addresses", () => {
  it("allows a private relay and rejects loopback, link-local, and mapped loopback", () => {
    expect(isMailAddressAllowed("10.1.1.1")).toBe(true);
    expect(isMailAddressAllowed("8.8.8.8")).toBe(true);
    expect(isMailAddressAllowed("127.0.0.1")).toBe(false);
    expect(isMailAddressAllowed("169.254.169.254")).toBe(false);
    expect(isMailAddressAllowed("::ffff:127.0.0.1")).toBe(false);
    expect(isMailAddressAllowed("::1")).toBe(false);
  });

  it("uses one IPv4 address and refuses the name when any address is blocked", () => {
    expect(chooseMailAddress(["10.0.0.5", "192.0.2.1"], ["2001:db8::1"])).toEqual({
      ok: true,
      address: "10.0.0.5",
      family: 4,
    });
    expect(chooseMailAddress(["10.0.0.5", "127.0.0.1"], []).ok).toBe(false);
  });
});

describe("mail save", () => {
  it("keeps the stored password when the field is empty", () => {
    const decision = planMailSave(
      {
        host: "smtp.example",
        port: 465,
        username: "ops@example.com",
        password: "",
        from: "ops@example.com",
        recipients: ["a@example.com"],
      },
      true,
    );
    expect(decision.ok).toBe(true);
    if (decision.ok && decision.mode === "set") expect(decision.password).toBeNull();
  });

  it("refuses a login without a password", () => {
    const decision = planMailSave(
      {
        host: "smtp.example",
        port: 587,
        username: "ops@example.com",
        password: "",
        from: "ops@example.com",
        recipients: ["a@example.com"],
      },
      false,
    );
    expect(decision).toEqual({ ok: false, error: "Укажите пароль." });
  });

  it("does not treat a stored IMAP port as ready", () => {
    expect(readyProbe(row({ port: 143 }))).toBeNull();
    expect(
      readyProbe(row({ recipients: ["a@example.com", "a@example.com"] })),
    ).toBeNull();
  });

  it("clears the channel when the host is empty and ignores a typed password", () => {
    const decision = planMailSave(
      {
        host: "  ",
        port: 587,
        username: "ops@example.com",
        password: SECRET,
        from: "ops@example.com",
        recipients: ["a@example.com"],
      },
      true,
    );
    expect(decision).toEqual({ ok: true, mode: "clear" });
  });
});

describe("mail dns", () => {
  it("does not connect when resolution finds a blocked address", async () => {
    const resolved = await resolveMailHost(
      "smtp.example",
      false,
      new AbortController().signal,
      {
        resolve4: async () => ["10.0.0.5", "127.0.0.1"],
        resolve6: async () => [],
      },
    );
    expect(resolved).toEqual({ ok: false, code: "name" });
  });
});

describe("mail smtp options", () => {
  it("requires TLS before AUTH and pins the chosen address", () => {
    const options = buildSmtpOptions({
      hostName: "smtp.example",
      address: "10.0.0.5",
      port: 587,
      username: "ops@example.com",
      password: SECRET,
    });
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
    expect(options.ignoreTLS).toBe(false);
    expect(options.host).toBe("10.0.0.5");
    expect(options.servername).toBe("smtp.example");
    expect(options.tls).toMatchObject({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: "smtp.example",
    });
    expect(options.auth).toEqual({
      type: "login",
      user: "ops@example.com",
      pass: SECRET,
    });
    expect(options.logger).toBe(false);
    expect(options.debug).toBe(false);

    const open = buildSmtpOptions({
      hostName: "smtp.example",
      address: "10.0.0.5",
      port: 465,
      username: null,
      password: null,
    });
    expect(open.secure).toBe(true);
    expect(open.auth).toBeUndefined();
  });

  it("sends the fixed probe and closes the transport", async () => {
    let closed = 0;
    let message: { subject?: string; text?: string; disableFileAccess?: boolean } = {};
    const sent = await deliverProbe(
      {
        hostName: "smtp.example",
        address: "10.0.0.5",
        port: 587,
        username: "ops@example.com",
        password: SECRET,
        from: "ops@example.com",
        recipients: ["a@example.com"],
        signal: new AbortController().signal,
        now: new Date("2026-11-21T00:00:00.000Z"),
      },
      (options: SmtpOptions) => {
        expect(options.auth && "pass" in options.auth ? options.auth.pass : "").toBe(
          SECRET,
        );
        return {
          sendMail: async (mail) => {
            message = mail;
            expect(JSON.stringify(mail)).not.toContain(SECRET);
            return { accepted: ["a@example.com"], rejected: [] };
          },
          close: () => {
            closed += 1;
          },
        };
      },
    );
    expect(sent).toEqual({ ok: true });
    expect(closed).toBe(1);
    expect(message.subject).toBe(PROBE_SUBJECT);
    expect(message.text).toBe(probeText(new Date("2026-11-21T00:00:00.000Z")));
    expect(message.disableFileAccess).toBe(true);
  });

  it("treats a certificate failure as a certificate phrase, not the raw error", () => {
    expect(
      classifySmtpError({
        code: "ESOCKET",
        cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      }),
    ).toBe("cert");
  });
});

describe("mail probe", () => {
  it("does not open SMTP for a broken row and releases the slot", async () => {
    resetMailSendSlot();
    let delivered = 0;
    let released = 0;
    const logs: unknown[] = [];
    const outcome = await runMailProbe({ userId: "admin" }, undefined, {
      read: async () => row({ recipients: "nope" }),
      decrypt: () => SECRET,
      resolve: async () => {
        throw new Error("dns should not run");
      },
      deliver: async () => {
        delivered += 1;
        return { ok: true };
      },
      hold: () => {
        const release = tryHoldMailSend();
        if (!release) return null;
        return () => {
          released += 1;
          release();
        };
      },
      limit: { check: () => ({ allowed: true, retryAfterSec: 0 }) },
      now: () => 0,
      audit: async () => undefined,
      log: (fields) => logs.push(fields),
    });
    expect(outcome.result).toBe("incomplete");
    expect(delivered).toBe(0);
    expect(released).toBe(1);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });
});

describe("mail hold", () => {
  it("allows one send at a time", () => {
    resetMailSendSlot();
    const first = tryHoldMailSend();
    expect(tryHoldMailSend()).toBeNull();
    first?.();
    expect(tryHoldMailSend()).not.toBeNull();
    resetMailSendSlot();
  });
});

describe("mail body", () => {
  it("rejects a probe body and a save above 32 KB", async () => {
    const probe = await readCappedBody(
      new Request("https://reg.local/mail", { method: "POST", body: "{}" }),
      0,
    );
    expect(probe.ok).toBe(false);
    const empty = await readCappedBody(
      new Request("https://reg.local/mail", { method: "POST" }),
      0,
    );
    expect(empty).toEqual({ ok: true, text: "" });
    const save = await readCappedBody(
      new Request("https://reg.local/mail", {
        method: "PUT",
        body: "x".repeat(32 * 1024 + 1),
      }),
      32 * 1024,
    );
    expect(save.ok).toBe(false);
  });
});
