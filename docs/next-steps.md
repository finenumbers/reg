# Next Steps

Phase 7 (production readiness) is complete. Recommended follow-ups are **ops enablement**, not new product features.

## 1. Go live (ops)

1. Follow [production-checklist.md](./production-checklist.md)
2. Configure softswitch per [remote-server-setup.md](./remote-server-setup.md)
3. Run [smoke-tests.md](./smoke-tests.md) against the public URL
4. Schedule DB backups + vault `APP_ENCRYPTION_KEY` ([backup-and-restore.md](./backup-and-restore.md))

## 2. Enable auto-poll (only when ready)

1. Single `app` replica confirmed
2. SSH test + manual regs poll, phones sync, and groups sync OK
3. Settings → enable regular registrations poll and/or phones+groups load (separate checkboxes and intervals, ≥30s) → Save
4. Watch `/jobs` for `trigger=schedule`; `phones.sync` / `groups.sync` alternate on the export interval. Disable the matching checkbox to stop that loop.

## 3. Enable VoIPmonitor links (optional)

1. Dedicated VoIPmonitor GUI API user (do not share Collector credentials if avoidable)
2. Settings → VoIPmonitor: API URL, user, password, GUI URL → Test → enable → Save
3. Watch `/jobs` for `voipmonitor.match` and the unenriched banner; `/raw` and `/traffic` should fill VoIPmonitor In/Out (Calltrace In/Out)

## 4. Optional later enhancements (out of v1 critical path)

- Shared rate-limit store + leader election (only if multi-replica becomes a hard requirement)
- Controlled artifact peek UI (still never expose key material)
- User admin UI beyond bootstrap/env (if operators need day-2 user management in-app)

## Do not start

- Multiple `app` replicas (in-process scheduler will duplicate polls)
- Arbitrary remote command fields from UI
- Weakening allowlist / key masking for convenience
- Treating SSH connection test as a registration poll
- Shipping with example `APP_ENCRYPTION_KEY` / placeholder auth secrets
