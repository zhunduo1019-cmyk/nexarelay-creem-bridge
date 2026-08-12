# NexaRelay Payment Database Recovery Runbook

## Verified protection

Verified in the Render dashboard on 2026-08-11:

- Database: `nexarelay-payments-db`
- Instance: `Basic-256mb`
- PostgreSQL: `18`
- Point-in-time recovery: any available timestamp in the past 3 days
- Logical exports: supported; Render retains each export for at least 7 days

The first Render logical export completed successfully at
`2026-08-11 14:45 UTC` (`.dir.tar.gz`). Its signed download URL is intentionally
not recorded in this repository. This confirms server-side export creation, but
an encrypted off-platform copy and restore drill are still required before Live
payments are enabled.

On 2026-08-12, that export was downloaded, encrypted locally with
AES-256-CBC plus HMAC-SHA256, and its 64-byte encryption/authentication key was
protected with Windows DPAPI for the current user. The encryption round-trip
reproduced the original SHA-256 exactly, and a separate restore invocation
verified the archive contains `toc.dat` and data files. All temporary and
Downloads plaintext copies were then removed. The encrypted backup, DPAPI key,
and non-secret manifest are stored in the Git-ignored `NexaRelay-Backups/`
directory with its ACL restricted to the current Windows user, SYSTEM, and
Administrators. Use `scripts/restore-render-backup.ps1` under the same Windows
user and permission context that created the DPAPI key.

The backup scripts are Windows-specific. `protect-render-backup.ps1` accepts
only an explicitly named `.gz` file directly inside the current user's
Downloads directory, verifies authentication and an exact decrypt round-trip,
and only then removes the plaintext source. `restore-render-backup.ps1` refuses
to overwrite an existing output path and authenticates the encrypted file
before decrypting it.

## Verified isolated restore drill

Completed on 2026-08-12 using PostgreSQL 18.4 Windows binaries linked from the
official PostgreSQL Windows downloads page. The encrypted backup authenticated
successfully, decrypted to the recorded SHA-256, and was restored into a new
PostgreSQL 18.4 instance listening only on `127.0.0.1:55432`. The source archive
was also produced by PostgreSQL 18.4.

The restored snapshot contained seven orders (`cancelled=1`, `credited=5`,
`pending=1`), 16 payment events, five credit deliveries, and two payment
adjustments. All four ledger tables were present, migrations 001 through 005
were recorded, and the duplicate `(provider, provider_event_id)` query returned
zero rows. The one pending row reflects the 2026-08-11 export snapshot and is
not the later stale Sandbox row that was safely closed in production.

A temporary copy of the current bridge was then started on `127.0.0.1:58787`
with only the isolated restore database URL. Its `/health` response reported
`ok=true`, `databaseReady=true`, Sandbox mode, and Live, public payments, and
automatic quota clawback all disabled. No production service was pointed at
the drill database. After verification, the temporary bridge and PostgreSQL
server were stopped and the decrypted archive, restored database, downloaded
binaries, and all other drill files were removed. The encrypted `.nrbak`, its
DPAPI-protected key, and the original non-secret manifest remain preserved.

This is a verified local encrypted copy, not yet an independent second storage
location. Copy both the `.nrbak` file and its `.dpapi-key` file to a separate
encrypted device or vault; neither file alone is sufficient for recovery.

The dashboard currently shows external PostgreSQL access allowed from
`0.0.0.0/0`. On 2026-08-12, this was verified as inherited from both the Render
Workspace and Environment rather than a database-specific rule. This is not
required by the bridge because it uses Render's internal database URL. Before
Live payments are enabled, review every service affected by those inherited
rules, then replace the broad rule with known administrator IP/CIDR entries (or
remove external access after off-platform backup automation is established).
Do not change the inherited rule from the database page without that impact
review; doing so could affect other projects or lock out administrators.

The cross-service impact review was completed on 2026-08-12. The Render
workspace contains one project and one Production environment with three
resources: `nexarelay-creem-bridge`, `nexarelay-payments-db`, and
`autolens-ai`. Workspace- or environment-level restrictions would therefore
also apply to `autolens-ai` and must not be changed as part of the payment
database hardening task. The database page separately exposes a PostgreSQL-only
inbound rule. Restricting or clearing that database-specific rule affects only
external connections to `nexarelay-payments-db`; the payment bridge's internal
Render connection remains available. Render's documentation confirms that
inbound rules govern public-internet access only and that same-region services
can continue using the database's internal URL.

Never paste a database URL, password, or PSQL command into chat, screenshots,
issues, logs, or GitHub.

## Routine backup

1. Open Render -> `nexarelay-payments-db` -> **Recovery**.
2. Under **Export**, click **Create export**. Do not start another export while
   one is already running.
3. Wait for the `.dir.tar.gz` export to appear, then download it.
4. Store the archive encrypted in two independent locations. Do not keep the
   only copy inside Render because dashboard exports expire after 7 days.
5. Record the UTC creation time, file size, and a SHA-256 checksum. Never record
   connection credentials with the backup metadata.

Create an export before any payment-schema migration and at least weekly while
payments remain closed. Move to automated off-platform daily retention before
public payments are enabled.

## Point-in-time recovery

Prefer PITR for recent accidental deletion or corruption because it usually
recovers a newer state than the latest logical export.

1. Keep `PAYMENT_PUBLIC_ENABLED=false`. If Live was enabled, set
   `PAYPAL_LIVE_ENABLED=false` and return `PAYPAL_MODE=sandbox` before recovery.
2. Record the incident time in UTC. Choose a restore point before the damaging
   operation and at least 10 minutes behind the current time.
3. In **Recovery**, click **Restore database**. Give the recovery instance a new
   name and copy the existing settings.
4. Render creates a separate database. Do not point the bridge at it yet.
5. Connect privately and verify migrations, row counts, recent order states,
   unique provider event IDs, and credit-delivery records.
6. Update only the bridge's `DATABASE_URL` to the recovered instance, redeploy,
   and confirm `/health` returns HTTP 200 with `databaseReady=true` while public
   payments remain disabled.
7. Reconcile pending, paid, review-required, refund, reversal, and dispute rows
   against PayPal before reopening any payment path.
8. Retain the original database until validation is complete. Suspend or delete
   it only after a separate approval and a fresh logical export.

## Logical-export restore drill

Only restore a logical export into a new empty PostgreSQL database. Restore
commands can drop and recreate database objects; never aim them at the active
payment database.

After restoring, validate at minimum:

```sql
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
SELECT COUNT(*) FROM payment_events;
SELECT COUNT(*) FROM credit_deliveries;
SELECT COUNT(*) FROM payment_adjustments;
SELECT provider, provider_event_id, COUNT(*)
FROM payment_events
GROUP BY provider, provider_event_id
HAVING COUNT(*) > 1;
```

The final query must return zero rows. A restore drill is not complete until the
recovered bridge passes its health check and no production service points to the
drill database.
