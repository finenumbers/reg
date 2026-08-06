# Softswitch scripts for Reg platform

## Registrations (`check_regs.sh`)

App command (PTY + sudo -n + cwd):

```text
/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'
```

Requires NOPASSWD on `/opt/scripts/check_regs.sh`. Softswitch script is cwd-sensitive.

## Phones (`export.py`)

App command (no PTY required; sudo -n + cwd):

```text
/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./export.py'
```

Read-only: `SELECT` from MVTS MySQL via `/etc/mvts3g/access-db.conf`. Prints JSON to
**stdout** (endpoints + gateways with the same decoded columns as the old Excel export).
Does **not** write `export.xlsx` and does **not** mutate MySQL.

Requires NOPASSWD on `/opt/scripts/export.py` (config file is root-readable only).

## Install

1. Copy scripts:

```bash
sudo install -o root -g root -m 0755 platform_exec.sh /opt/scripts/platform_exec.sh
sudo install -o root -g root -m 0755 export.py /opt/scripts/export.py
sudo install -o root -g root -m 0755 check_regs.sh /opt/scripts/check_regs.sh   # if not already
```

2. Sudoers (replace `PLATFORM_USER`):

```bash
sudo sed 's/PLATFORM_USER/dvpershin/g' sudoers-platform-reg \
  | sudo tee /etc/sudoers.d/platform-reg
sudo chmod 0440 /etc/sudoers.d/platform-reg
sudo visudo -cf /etc/sudoers.d/platform-reg
```

3. Forced command on the **platform** public key in `~PLATFORM_USER/.ssh/authorized_keys` (recommended):

```text
command="/opt/scripts/platform_exec.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding <key-type> <base64> platform-reg
```

Do **not** set `no-pty` — Reg requests a PTY for `check_regs.sh`.

## Smoke

```bash
# regs — expect Registered + IP (use -tt for PTY)
ssh -tt -i <platform_key> PLATFORM_USER@softswitch \
  "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'"

# phones — expect JSON on stdout (no xlsx file created)
ssh -i <platform_key> PLATFORM_USER@softswitch \
  "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./export.py'" | head -c 200

# If forced command is enabled: must NOT open a shell
ssh -i <platform_key> PLATFORM_USER@softswitch whoami
```

| Symptom | Likely cause |
|---------|----------------|
| `sudo: a password is required` | NOPASSWD missing/wrong for this user/path |
| `Permission denied` on `access-db.conf` | Command ran without sudo elevation |
| All `Unregistered;` but interactive shows Registered | Missing `cd /opt/scripts` / wrong cwd / missing PTY |
| `platform_exec: denied command` | Wrapper allowlist not updated for `export.py` |
| `whoami` returns a username interactively | Forced command not applied (if you intended to use it) |
