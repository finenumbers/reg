# Remote softswitch setup (ops runbook)

Checklist for the Debian softswitch that this platform reaches over SSH.  
Application allowlist alone is **not** enough — layers B and C from [security-model.md](./security-model.md) must be configured on the host.

**App command (constant, code-owned, with PTY):**
`/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'`  
Matches interactive `cd /opt/scripts && sudo ./check_regs.sh`. Password sudo is not available to Reg — use NOPASSWD. Ready-to-copy files: [ops/softswitch/](../ops/softswitch/).

## 1. Dedicated unix user + key

1. Create a dedicated user for the platform (not a personal admin account).
2. Install **only** the platform’s public key in that user’s `authorized_keys`.
3. Do not reuse interactive admin keys.

## 2. Forced command + wrapper (recommended)

In `authorized_keys` for the platform key:

```text
command="/opt/scripts/platform_exec.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding <key-type> <base64-key> platform-reg
```

Do **not** set `no-pty`: Reg requests a PTY so `check_regs.sh` matches interactive-terminal output. Forced `command=` still prevents an interactive shell.

Install [ops/softswitch/platform_exec.sh](../ops/softswitch/platform_exec.sh) as `/opt/scripts/platform_exec.sh` (root-owned, `0755`). The wrapper must:

1. Read `SSH_ORIGINAL_COMMAND`
2. Accept bare path, absolute `sudo -n -- /opt/scripts/check_regs.sh`, or the fixed bash -c cwd form
3. `cd /opt/scripts` then `exec /usr/bin/sudo -n -- ./check_regs.sh`
4. Exit non-zero for anything else

The app sends the fixed bash -c cwd + sudo -n form for `regs.poll` **with a PTY**. It never takes a sudo string from UI/settings.

## 3. Script placement + permissions

1. Place scripts only under `/opt/scripts/`.
2. Prefer root-owned scripts, mode `0755` or tighter; not world-writable.
3. Platform user needs execute rights on the wrapper/script; privileged work runs via sudo as below.

## 4. Narrow sudo (required for app poll)

`check_regs.sh` needs privileged reads (e.g. `/etc/mvts3g/access-db.conf`). Install [ops/softswitch/sudoers-platform-reg](../ops/softswitch/sudoers-platform-reg) as `/etc/sudoers.d/platform-reg` with the real platform username substituted for `PLATFORM_USER`. Validate with `visudo -cf`.

Forbidden: `sudo ALL`, user-controlled sudo arguments, sudo strings from UI.

## 5. Smoke checks from an ops workstation

With the same key the platform will use — **exact app command** (use `-tt` for PTY):

```bash
# Expect Registered + IP like interactive sudo ./check_regs.sh
ssh -tt -i platform_key platform@softswitch \
  "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'"

# If forced command is enabled: must NOT give a shell
ssh -i platform_key platform@softswitch whoami
```

| Symptom | Likely cause |
|---------|----------------|
| `sudo: a password is required` | NOPASSWD not installed for this user/path |
| All `Unregistered;` while interactive shows Registered | Missing `cd /opt/scripts` (wrong cwd) |
| `Permission denied` on `access-db.conf` / empty stdout | Command ran without elevation |
| `whoami` returns a username interactively | Forced command not applied — fix `authorized_keys` if you use it |

Interactive success alone is **not** enough unless the smoke above (without password prompt) shows Registered:

```bash
# Human path — may use cached/password sudo; does not prove Reg can poll
cd /opt/scripts && sudo ./check_regs.sh
```

## 6. Platform settings after host is ready

1. Configure SSH host/port/username + import key in Settings (replace-only).
2. Run **SSH connection test** (auth/session only — does not run `check_regs.sh`).
3. Run a **manual poll** from Registrations once the smoke above shows Registered.
4. Only then enable Settings `regsPollEnabled` with a **single** `app` replica.

## 7. App deploy reminders

- Production stack/order: [production-checklist.md](./production-checklist.md)
- After softswitch + app are up: [smoke-tests.md](./smoke-tests.md)
- Preserve `APP_ENCRYPTION_KEY` with DB backups: [backup-and-restore.md](./backup-and-restore.md)

See also [security-model.md](./security-model.md) and [architecture.md](./architecture.md).
