---
title: "Redis Backup, Restore, and Disaster Recovery"
description: "Protect and recover the complete Cycles Redis state safely, with RDB and AOF backups, isolated restore validation, cutover, and rollback checks."
---

# Redis Backup, Restore, and Disaster Recovery

Redis is the durable state store for the Cycles runtime, admin, and events services. A recovery plan must restore the complete Redis dataset as one consistency boundary—not selected keys.

A Cycles dataset includes budget balances, reservations, idempotency records, tenants, API keys, policies, webhook subscriptions, events, audit records, delivery queues, and CyclesEvidence queues and envelopes. Restoring only one family can separate a balance from the reservations or idempotency records that explain it.

This runbook targets Redis Open Source 7+, the minimum supported Redis generation for Cycles. For Redis Cloud or Redis Software, use the provider's backup and restore controls, then apply the Cycles validation and cutover steps below.

## Choose recovery objectives

Set and test these objectives before an incident:

| Objective | Decision |
|---|---|
| Recovery point objective (RPO) | Maximum Cycles writes you can lose. AOF `everysec` generally targets about one second; periodic RDB alone can lose the interval since the last snapshot. |
| Recovery time objective (RTO) | Maximum time to restore Redis, validate Cycles state, and reopen writes. Measure this with production-sized restore drills. |
| Backup retention | Keep multiple hourly and daily restore points, not only the newest file. |
| Offsite boundary | Store at least one encrypted copy outside the Redis host and failure domain. |
| Restore owner | Name the operator authorized to stop writes, select a restore point, and approve cutover. |

Redis documents the durability and performance tradeoffs in its [persistence guide](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/). For production Cycles state, use both AOF and periodic RDB snapshots unless your managed Redis service provides an equivalent durability model.

## Production persistence baseline

```conf
appendonly yes
appendfsync everysec

save 900 1
save 300 10

maxmemory-policy noeviction
stop-writes-on-bgsave-error yes
```

`noeviction` is required for budget integrity. Evicting a ledger, reservation, or idempotency record can make later decisions inconsistent.

RDB is a compact point-in-time backup. AOF replays writes and offers a tighter recovery point. When both are enabled, Redis uses AOF on restart because it is normally the more complete dataset.

## Inventory the live instance

Record the persistence paths and health before every backup:

```bash
redis-cli CONFIG GET dir
redis-cli CONFIG GET dbfilename
redis-cli CONFIG GET appenddirname
redis-cli INFO persistence
redis-cli DBSIZE
```

Use your platform's secret injection for Redis authentication; avoid putting passwords directly in command history or process arguments.

Capture:

- Redis version and deployment topology;
- logical database number used by Cycles;
- `DBSIZE`;
- `rdb_last_bgsave_status`;
- `aof_enabled`, `aof_last_write_status`, and `aof_last_bgrewrite_status`;
- queue depths for `dispatch:pending`, `dispatch:processing`, `dispatch:retry`, `evidence:pending`, and `evidence:processing`;
- the Cycles component versions and encryption/evidence identity configuration.

Key counts are a coarse comparison only. TTL expiry and retention jobs can legitimately change them between backup and restore.

## Create an RDB backup

1. Start a background snapshot:

   ```bash
   redis-cli BGSAVE
   ```

2. Poll `INFO persistence` until:

   ```text
   rdb_bgsave_in_progress:0
   rdb_last_bgsave_status:ok
   ```

3. Record `LASTSAVE`, then copy the completed RDB file from the configured `dir` and `dbfilename`.
4. Compute a cryptographic checksum, encrypt the backup, and copy it off-host.
5. Record the checksum, Redis version, creation time, key count, and Cycles fleet versions alongside the backup.

Redis writes RDB snapshots to a temporary file and atomically replaces the completed snapshot, so copying the completed RDB while Redis remains online is safe. `BGSAVE` behavior and `LASTSAVE` verification are documented in the official [`BGSAVE` reference](https://redis.io/docs/latest/commands/bgsave/).

## Create an AOF backup on Redis 7+

Redis 7 stores AOF as a multipart set with a manifest in `appenddirname`. Copy the entire directory, not one file.

1. Read and record the current `auto-aof-rewrite-percentage`.
2. Temporarily disable automatic rewrites:

   ```bash
   redis-cli CONFIG SET auto-aof-rewrite-percentage 0
   ```

3. Check `INFO persistence` until `aof_rewrite_in_progress:0`. Do not run `BGREWRITEAOF` during the copy.
4. Copy or archive the complete configured `appenddirname`, including its manifest.
5. Restore the previous rewrite percentage immediately:

   ```bash
   redis-cli CONFIG SET auto-aof-rewrite-percentage 100
   ```

   Replace `100` with the value recorded in step 1.

6. Encrypt, checksum, and transfer the archive off-host.

The temporary rewrite pause is required because copying multipart AOF files during a rewrite can produce an invalid backup. Redis's [AOF backup procedure](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/#backing-up-aof-persistence) is authoritative.

## Validate every backup

A successful file copy is not a successful recovery test.

1. Restore the backup into an isolated Redis instance using the same Redis major version and configuration shape.
2. Keep the isolated instance unreachable from all Cycles services and clients.
3. Confirm Redis starts without persistence-load errors.
4. Compare `INFO persistence`, `DBSIZE`, and representative key types with the backup manifest.
5. Point isolated runtime and admin instances at a disposable copy of the restored Redis and perform the read-only checks in [Validate Cycles state](#_4-validate-cycles-state). Test the events worker only with outbound network access blocked: it is an active queue consumer, not a read-only service.
6. Record restore duration, data checks, and any manual steps. The measured duration—not the archive copy time—is your practical RTO.

Run this drill on a schedule and after changes to Redis version, persistence mode, encryption keys, or Cycles storage behavior.

## Restore after data loss

### 1. Declare a write outage

Stop or isolate all writers before restoring:

- runtime server instances;
- admin server instances;
- events-service workers;
- automation calling the runtime or admin APIs.

Stopping only the dashboard is insufficient. SDKs, agents, webhooks, and background jobs can still write.

### 2. Preserve incident evidence

Before replacing anything:

- snapshot or archive the failed Redis volume if it is readable;
- save Redis and Cycles logs;
- record the failure time and last known good operation;
- record checksums for the candidate backup;
- do not run `redis-check-aof --fix` on the only copy.

For AOF corruption, Redis recommends making a copy and running `redis-check-aof` without `--fix` first. Repair can discard data from the corruption point onward.

### 3. Restore into a new Redis instance

Prefer a new isolated instance or volume over overwriting the failed one.

- For RDB recovery, place the snapshot at the configured `dir`/`dbfilename` before Redis starts.
- For Redis 7 multipart AOF recovery, restore the complete `appenddirname` and manifest.
- Preserve file ownership and permissions required by the Redis process.
- Start Redis with the intended production persistence settings.

Do not combine an RDB from one restore point with AOF files from another. If both are present, Redis loads AOF, so an unintended stale AOF directory can silently override the RDB you meant to test.

### 4. Validate Cycles state

Keep application writes blocked while validating:

```bash
redis-cli PING
redis-cli INFO persistence
redis-cli DBSIZE
redis-cli LLEN dispatch:pending
redis-cli LLEN dispatch:processing
redis-cli ZCARD dispatch:retry
redis-cli LLEN evidence:pending
redis-cli LLEN evidence:processing
```

Then start one isolated runtime instance and one admin instance against the restored Redis. Test the events service against a disposable clone with outbound webhook access blocked; starting it against the cutover candidate can consume queues and change delivery state.

Verify:

- runtime and admin readiness report `UP`; the isolated events-worker test also reports `UP`;
- tenant, budget, API-key metadata, policy, webhook, event, and audit list endpoints can read representative records;
- balances reconcile with expected allocations, spent amounts, reserved amounts, debt, and remaining values;
- open reservations refer to existing ledgers and have plausible expirations;
- failed and pending delivery/evidence queues have expected depths;
- encrypted webhook secrets can be decrypted using the original `WEBHOOK_SECRET_ENCRYPTION_KEY`;
- the evidence signer identity and retired-key history match the restored evidence records.

Use read-only requests until the restore point has been approved.

### 5. Account for the recovery window

A point-in-time restore can remove writes that clients observed as successful after the restore point. It can also restore an idempotency record whose downstream side effect occurred after that point.

Before reopening writes:

- identify runtime/admin requests accepted between the backup time and the outage;
- reconcile downstream LLM, tool, or payment-side effects with Cycles reservations and commits;
- do not blindly replay mutating requests with new idempotency keys;
- expect already-expired Redis TTL records to disappear during or immediately after load;
- decide whether webhook/evidence queue items need replay, suppression, or downstream deduplication.

Cycles records economic exposure; it does not reverse downstream actions when Redis is restored.

### 6. Cut over

1. Put the restored Redis behind the production endpoint.
2. Start one instance of each Cycles service.
3. Repeat the read-only validation.
4. Permit one controlled reserve → commit lifecycle and confirm the balance delta.
5. Start remaining service replicas.
6. Re-enable client traffic gradually while watching errors, denials, queue depth, and Redis persistence status.

## Roll back the restore

Keep the pre-restore Redis volume and restored candidate until validation is complete. If the candidate fails:

1. block Cycles writes again;
2. preserve the candidate and its logs;
3. switch back to the previous isolated instance or choose an earlier verified restore point;
4. repeat validation before reopening traffic.

Never switch between two independently writable Redis instances. Cycles does not merge divergent ledgers.

## Drill checklist

- [ ] RPO and RTO are documented and approved.
- [ ] RDB and multipart AOF backups are encrypted and stored off-host.
- [ ] Backup checksums and version metadata are recorded.
- [ ] A production-sized restore has been completed in isolation.
- [ ] The complete Cycles state—not selected key families—was restored.
- [ ] Webhook encryption and evidence signer identities were available during the drill.
- [ ] Read-only Cycles validation passed.
- [ ] One controlled reserve → commit lifecycle passed before reopening traffic.
- [ ] Measured restore and validation time meets the RTO.
- [ ] Reconciliation ownership for the recovery window is assigned.

## Related

- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) — authoritative RDB and AOF behavior
- [Production Operations](/how-to/production-operations-guide)
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles)
- [Monitoring and Alerting](/how-to/monitoring-and-alerting)
- [Retry Storms and Idempotency Failures](/incidents/retry-storms-and-idempotency-failures)
