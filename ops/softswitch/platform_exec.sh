#!/bin/bash
# Forced-command SSH wrapper for Reg platform keys.
# Install as /opt/scripts/platform_exec.sh (root-owned, mode 0755).
# authorized_keys: command="/opt/scripts/platform_exec.sh",no-port-forwarding,...
# Do not set no-pty — check_regs.sh needs a TTY for correct Registered output.
#
# Allowlisted scripts only (basename dispatch). App may send bare path,
# absolute sudo, or the fixed bash -c cwd form.

set -euo pipefail

SUDO_BIN="/usr/bin/sudo"
SCRIPTS_DIR="/opt/scripts"

ALLOWED_BASENAMES=(
  "check_regs.sh"
  "export.py"
)

cmd="${SSH_ORIGINAL_COMMAND:-}"

match_basename=""
for base in "${ALLOWED_BASENAMES[@]}"; do
  bare="${SCRIPTS_DIR}/${base}"
  sudo_abs="${SUDO_BIN} -n -- ${bare}"
  bash_cwd="/bin/bash -c 'cd ${SCRIPTS_DIR} && exec ${SUDO_BIN} -n -- ./${base}'"
  if [[ "${cmd}" == "${bare}" \
     || "${cmd}" == "${sudo_abs}" \
     || "${cmd}" == "${bash_cwd}" ]]; then
    match_basename="${base}"
    break
  fi
done

if [[ -z "${match_basename}" ]]; then
  printf 'platform_exec: denied command\n' >&2
  exit 126
fi

cd "${SCRIPTS_DIR}" || exit 1

# Non-interactive sudo; requires NOPASSWD on the exact script path for this user.
exec "${SUDO_BIN}" -n -- "./${match_basename}"
