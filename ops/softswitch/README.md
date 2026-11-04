# Softswitch scripts for Reg platform

## Registrations

The app reads «Регистрации (ПКомм)» and «Регистрации (ПУпр)» from the RTU API. It does not run `check_regs.sh` and does not request a PTY. Leave the script and its sudoers entry in place so an image rollback can restore the old poll.

## Phones (`export.py`)

App command (no PTY required; sudo -n + cwd) — used by `phones.sync`. Incoming groups are read from the RTU API and do not run this script:

```text
/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./export.py'
```

Read-only: `SELECT` from MVTS MySQL via `/etc/mvts3g/access-db.conf`. Prints JSON to
**stdout** (`version` 2): endpoints, gateways, and `groups[]` (`ID` / `Название` from
`mvts_routing_groups`, ordered by `routing_group_id`). Does **not** write `export.xlsx`
and does **not** mutate MySQL.

Requires NOPASSWD on `/opt/scripts/export.py` (config file is root-readable only).
File must be executable (`chmod +x` / `install -m 0755`).

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

The current app does not request a PTY. Leave `no-pty` unset so an image rollback can still run `check_regs.sh`.

## Smoke

```bash
# regs — expect Registered + IP (use -tt for PTY)
ssh -tt -i <platform_key> PLATFORM_USER@softswitch \
  "/bin/bash -c 'cd /opt/scripts && exec /usr/bin/sudo -n -- ./check_regs.sh'"

# phones / groups — expect JSON on stdout with "groups" (no xlsx file created)
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
| `sudo: ./export.py: command not found` | Missing execute bit on `/opt/scripts/export.py` |
| `platform_exec: denied command` | Wrapper allowlist not updated for `export.py` |
| `whoami` returns a username interactively | Forced command not applied (if you intended to use it) |
