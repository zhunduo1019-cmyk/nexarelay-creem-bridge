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

The dashboard currently shows external PostgreSQL access allowed from
`0.0.0.0/0`. This is not required by the bridge because it uses Render's
internal database URL. Before Live payments are enabled, replace the broad rule
with a known administrator IP/CIDR (or remove external access entirely after
off-platform backup automation is established). Validate the intended admin
source before removing the existing rule to avoid an accidental lockout.

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
