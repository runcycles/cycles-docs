"""Run: python -m unittest discover -s scripts/__tests__ -p test_rollback_risk_drill.py"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import runpy
import sqlite3
from tempfile import TemporaryDirectory
from threading import Barrier
import unittest


SCRIPT = Path(__file__).resolve().parents[2] / 'public/examples/agent-rollback-risk-drill.py'
spec = importlib.util.spec_from_file_location('rollback_drill', SCRIPT)
drill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill)


class RollbackRiskTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(prefix='rollback-test-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'test.db'
        self.db = drill.connect(self.path)
        self.addCleanup(self.db.close)
        drill.seed(self.db, 2000)

    def repair(self, grant='grant-1', principal='recovery-worker', operation='op-1', now=1000):
        return drill.repair(self.db, grant, principal, operation, now=now)

    def snapshot(self):
        return [tuple(row) for row in self.db.execute('SELECT * FROM accounts ORDER BY account_id')]

    def test_scoped_repair_preserves_other_fields_and_accounts(self):
        untouched = drill.account(self.db, 'account-2')
        result = self.repair()
        row = drill.account(self.db, 'account-1')
        self.assertEqual((row['status'], row['version'], row['note']),
                         ('active', 3, 'Retain this note'))
        self.assertFalse(result['replayed'])
        self.assertEqual(drill.account(self.db, 'account-2'), untouched)

    def test_authorization_refusals_leave_no_effects(self):
        before = self.snapshot()
        for params in [{'grant': 'missing'}, {'principal': 'original-agent'},
                       {'now': 2000}, {'now': 2001}, {'operation': ''}]:
            with self.subTest(params=params), self.assertRaises(drill.RecoveryBlocked):
                self.repair(**params)
            self.assertEqual(self.snapshot(), before)
            self.assertFalse(self.db.in_transaction)
        self.db.execute("UPDATE grants SET revoked = 1 WHERE grant_id = 'grant-1'")
        with self.assertRaises(drill.RecoveryBlocked):
            self.repair()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM repairs').fetchone()[0], 0)

    def test_intervening_update_is_preserved(self):
        self.db.execute("UPDATE accounts SET status = 'manual-review', version = 3 WHERE account_id = 'account-1'")
        before = self.snapshot()
        with self.assertRaisesRegex(drill.RecoveryBlocked, 'Current state differs'):
            self.repair()
        self.assertEqual(self.snapshot(), before)

    def test_status_mismatch_blocks_even_without_version_increment(self):
        self.db.execute("UPDATE accounts SET status = 'manual-review' WHERE account_id = 'account-1'")
        with self.assertRaises(drill.RecoveryBlocked):
            self.repair()
        self.assertEqual(drill.account(self.db, 'account-1')['status'], 'manual-review')

    def test_unrelated_versioned_update_requires_new_review(self):
        self.db.execute("UPDATE accounts SET note = 'Support correction', version = 3 WHERE account_id = 'account-1'")
        before = self.snapshot()
        with self.assertRaises(drill.RecoveryBlocked):
            self.repair()
        self.assertEqual(self.snapshot(), before)

    def test_receipt_persists_across_connection_loss(self):
        first = self.repair()
        with self.db:
            before = self.snapshot()
        other = drill.connect(self.path)
        try:
            replay = drill.repair(other, 'grant-1', 'recovery-worker', 'op-1', now=1001)
        finally:
            other.close()
        self.assertTrue(replay['replayed'])
        self.assertEqual(first['resulting_version'], replay['resulting_version'])
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM repairs').fetchone()[0], 1)

    def test_replay_does_not_restore_over_subsequent_changes(self):
        self.repair()
        self.db.execute("UPDATE accounts SET status = 'closed', version = 4 WHERE account_id = 'account-1'")
        before = self.snapshot()
        result = self.repair()
        self.assertTrue(result['replayed'])
        self.assertEqual(result['resulting_version'], 3)
        self.assertEqual(self.snapshot(), before)

    def test_new_identity_does_not_reuse_consumed_grant(self):
        self.repair()
        before = self.snapshot()
        with self.assertRaisesRegex(drill.RecoveryBlocked, 'Grant already used'):
            self.repair(operation='new-op')
        self.assertEqual(self.snapshot(), before)

    def test_operation_identity_cannot_switch_grants(self):
        self.repair()
        before = self.snapshot()
        with self.assertRaisesRegex(drill.RecoveryBlocked, 'identity reused'):
            self.repair(grant='grant-2')
        self.assertEqual(self.snapshot(), before)

    def test_replay_still_requires_current_authorization(self):
        self.repair()
        for params in [{'principal': 'original-agent'}, {'now': 2000}]:
            with self.subTest(params=params), self.assertRaises(drill.RecoveryBlocked):
                self.repair(**params)
        self.db.execute("UPDATE grants SET revoked = 1 WHERE grant_id = 'grant-1'")
        with self.assertRaises(drill.RecoveryBlocked):
            self.repair()
        self.assertEqual(drill.account(self.db, 'account-1')['version'], 3)

    def test_receipt_failure_rolls_back_the_mutation(self):
        self.db.execute("""CREATE TRIGGER fail_receipt BEFORE INSERT ON repairs
                        BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END""")
        before = self.snapshot()
        with self.assertRaises(sqlite3.IntegrityError):
            self.repair()
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.db.in_transaction)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM repairs').fetchone()[0], 0)

    def test_concurrent_replays_produce_one_mutation(self):
        barrier = Barrier(2)
        def worker():
            db = drill.connect(self.path)
            try:
                barrier.wait(timeout=5)
                return drill.repair(db, 'grant-1', 'recovery-worker', 'op-1', now=1000)
            finally:
                db.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(worker) for _ in range(2)]
            results = [f.result(timeout=10) for f in futures]
        self.assertEqual(sorted(r['replayed'] for r in results), [False, True])
        self.assertEqual(drill.account(self.db, 'account-1')['version'], 3)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM repairs').fetchone()[0], 1)

    def test_busy_database_does_not_bypass_checks(self):
        self.db.execute('BEGIN IMMEDIATE')
        other = drill.connect(self.path)
        other.execute('PRAGMA busy_timeout = 0')
        try:
            with self.assertRaises(sqlite3.OperationalError):
                drill.repair(other, 'grant-1', 'recovery-worker', 'op-1', now=1000)
        finally:
            other.close()
            self.db.execute('ROLLBACK')
        self.assertEqual(drill.account(self.db, 'account-1')['version'], 2)

    def test_runnable_drill_reports_all_four_cases(self):
        output = io.StringIO()
        with redirect_stdout(output):
            runpy.run_path(str(SCRIPT), run_name='__main__')
        rows = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([row['scenario'] for row in rows],
                         ['scoped_repair', 'stale_state', 'wrong_principal', 'replay_after_reconnect'])
        self.assertTrue(all(row['result'] == 'PASS' for row in rows))


if __name__ == '__main__':
    unittest.main()
