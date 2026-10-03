"""Python 3.10+ standard-library recovery drill; no services or credentials.

Uses a temporary SQLite database. Grants, identity, and original change receipts
are trusted host fixtures, not values an agent may issue or edit. This is a local
transaction demonstration, not a distributed rollback service or Cycles client.
"""

import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import time


class RecoveryBlocked(Exception):
    """Stop and escalate; do not broaden the recovery request automatically."""


def connect(path):
    db = sqlite3.connect(path, isolation_level=None, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def seed(db, expires_at):
    """Trusted fixture setup: two mistaken changes and narrowly scoped grants."""
    db.executescript("""
        CREATE TABLE accounts (
            tenant TEXT, account_id TEXT, status TEXT NOT NULL,
            version INTEGER NOT NULL, note TEXT NOT NULL,
            PRIMARY KEY (tenant, account_id)
        );
        CREATE TABLE changes (
            change_id TEXT PRIMARY KEY, tenant TEXT, account_id TEXT,
            before_status TEXT NOT NULL, after_status TEXT NOT NULL,
            after_version INTEGER NOT NULL,
            FOREIGN KEY (tenant, account_id) REFERENCES accounts(tenant, account_id)
        );
        CREATE TABLE grants (
            grant_id TEXT PRIMARY KEY, change_id TEXT UNIQUE NOT NULL,
            principal TEXT NOT NULL, expires_at INTEGER NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (change_id) REFERENCES changes(change_id)
        );
        CREATE TABLE repairs (
            operation_id TEXT PRIMARY KEY, grant_id TEXT UNIQUE NOT NULL,
            resulting_version INTEGER NOT NULL,
            FOREIGN KEY (grant_id) REFERENCES grants(grant_id)
        );
    """)
    for number in (1, 2):
        db.execute("INSERT INTO accounts VALUES (?, ?, ?, ?, ?)",
                   ("acme", f"account-{number}", "suspended", 2, "Retain this note"))
        db.execute("INSERT INTO changes VALUES (?, ?, ?, ?, ?, ?)",
                   (f"change-{number}", "acme", f"account-{number}", "active", "suspended", 2))
        db.execute("INSERT INTO grants VALUES (?, ?, ?, ?, 0)",
                   (f"grant-{number}", f"change-{number}", "recovery-worker", expires_at))


def repair(db, grant_id, principal, operation_id, now=None):
    """Restore one approved field only if the recorded post-change state matches.

    The host supplies authenticated principal and trusted time. Grant lookup,
    conditional mutation, and replay receipt share one local transaction.
    All writers must increment account.version; grant/change rows are immutable
    except for host-controlled revocation. A production host must enforce this.
    """
    if not operation_id:
        raise RecoveryBlocked("Missing operation identity")
    db.execute("BEGIN IMMEDIATE")
    try:
        observed_time = time.time() if now is None else now
        grant = db.execute("""
            SELECT g.*, c.tenant, c.account_id, c.before_status,
                   c.after_status, c.after_version
            FROM grants g JOIN changes c ON c.change_id = g.change_id
            WHERE g.grant_id = ?
        """, (grant_id,)).fetchone()
        if (grant is None or grant["principal"] != principal
                or grant["revoked"] or observed_time >= grant["expires_at"]):
            raise RecoveryBlocked("Recovery grant unavailable for this caller")

        prior = db.execute("SELECT * FROM repairs WHERE operation_id = ?",
                           (operation_id,)).fetchone()
        if prior:
            if prior["grant_id"] != grant_id:
                raise RecoveryBlocked("Operation identity reused for another grant")
            result = {"operation_id": operation_id, "grant_id": grant_id,
                      "resulting_version": prior["resulting_version"], "replayed": True}
        else:
            if db.execute("SELECT 1 FROM repairs WHERE grant_id = ?", (grant_id,)).fetchone():
                raise RecoveryBlocked("Grant already used; reconcile the original operation")
            changed = db.execute("""
                UPDATE accounts SET status = ?, version = version + 1
                WHERE tenant = ? AND account_id = ? AND version = ? AND status = ?
            """, (grant["before_status"], grant["tenant"], grant["account_id"],
                  grant["after_version"], grant["after_status"]))
            if changed.rowcount != 1:
                raise RecoveryBlocked("Current state differs; new review required")
            version = grant["after_version"] + 1
            db.execute("INSERT INTO repairs VALUES (?, ?, ?)", (operation_id, grant_id, version))
            result = {"operation_id": operation_id, "grant_id": grant_id,
                      "resulting_version": version, "replayed": False}
        db.execute("COMMIT")
        return result
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def account(db, account_id):
    return dict(db.execute("SELECT * FROM accounts WHERE tenant = ? AND account_id = ?",
                           ("acme", account_id)).fetchone())


def check(condition, message):
    # Do not disable drill checks when Python runs with -O.
    if not condition:
        raise RuntimeError(message)


def expect_blocked(db, grant_id, principal, operation_id, scenario):
    before = [account(db, "account-1"), account(db, "account-2")]
    try:
        repair(db, grant_id, principal, operation_id)
    except RecoveryBlocked as exc:
        check(before == [account(db, "account-1"), account(db, "account-2")],
              "Blocked recovery changed an account")
        print(json.dumps({"scenario": scenario, "result": "PASS", "reason": str(exc)}))
    else:
        raise RuntimeError("Expected recovery to be blocked")


def main():
    with TemporaryDirectory(prefix="agent-rollback-drill-") as directory:
        path = Path(directory) / "accounts.db"
        db = connect(path)
        try:
            seed(db, int(time.time()) + 600)
            result = repair(db, "grant-1", "recovery-worker", "repair-1")
            row = account(db, "account-1")
            check(not result["replayed"] and row["status"] == "active" and row["version"] == 3
                  and row["note"] == "Retain this note", "Repair did not match its approved scope")
            print(json.dumps({"scenario": "scoped_repair", "result": "PASS", **result}))

            # A legitimate intervention AFTER planning makes the second grant stale.
            db.execute("UPDATE accounts SET status = 'manual-review', version = 3 WHERE account_id = 'account-2'")
            expect_blocked(db, "grant-2", "recovery-worker", "repair-2", "stale_state")
            expect_blocked(db, "grant-2", "original-agent", "repair-3", "wrong_principal")
        finally:
            db.close()

        # Simulate losing the response/connection after commit. Persisted receipt
        # proves the earlier operation; it is NOT evidence of current account state.
        db = connect(path)
        try:
            before = account(db, "account-1")
            replay = repair(db, "grant-1", "recovery-worker", "repair-1")
            check(replay["replayed"] and before == account(db, "account-1"), "Replay mutated state")
            check(db.execute("SELECT COUNT(*) FROM repairs").fetchone()[0] == 1,
                  "Expected exactly one completed repair")
            print(json.dumps({"scenario": "replay_after_reconnect", "result": "PASS", **replay}))
        finally:
            db.close()


if __name__ == "__main__":
    main()
