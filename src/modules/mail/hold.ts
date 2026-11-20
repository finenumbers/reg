/** One outbound SMTP send at a time. The slot dies with the process. */

type MailSlot = { held: boolean };

const KEY = "__reg_mail_send__";

function slot(): MailSlot {
  const g = globalThis as typeof globalThis & { [KEY]?: MailSlot };
  if (!g[KEY]) g[KEY] = { held: false };
  return g[KEY];
}

export function tryHoldMailSend(): (() => void) | null {
  const current = slot();
  if (current.held) return null;
  current.held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.held = false;
  };
}

export function resetMailSendSlot(): void {
  slot().held = false;
}
