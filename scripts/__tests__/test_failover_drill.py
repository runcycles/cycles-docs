"""Failure-boundary checks: python -m unittest discover -s scripts/__tests__ -p test_failover_drill.py.

Requires the example's runcycles==0.5.3 dependency. Live ledger arithmetic is
also exercised by running the downloadable drill against a disposable tenant.
"""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

path = Path(__file__).resolve().parents[2] / 'public/examples/llm-failover-budget-drill.py'
spec = importlib.util.spec_from_file_location('failover_drill', path)
drill = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = drill
spec.loader.exec_module(drill)


def response(status=200, **body):
    return SimpleNamespace(status=status, body=body)


class FailoverBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.quiet = patch.object(drill, 'emit')
        self.quiet.start()
        self.addCleanup(self.quiet.stop)
        self.subject = {'tenant': 'test', 'workflow': 'task'}
        self.client = Mock()
        self.client.create_reservation.return_value = response(
            reservation_id='r1', decision='ALLOW', remaining_ttl_ms=60_000)
        self.client.release_reservation.return_value = SimpleNamespace(status=200, body={'status': 'RELEASED'})

    def test_bad_admission_never_calls_provider(self):
        for admission in [response(503), response(decision='ALLOW'),
                          response(reservation_id='r', decision='DENY'),
                          response(reservation_id='r', decision='ALLOW', remaining_ttl_ms=0),
                          response(reservation_id='r', decision='ALLOW_WITH_CAPS'),
                          response(reservation_id='r', decision='ALLOW', caps={'max_tokens': 1})]:
            with self.subTest(admission=admission):
                provider = drill.Provider('primary', 4, 3)
                self.client.create_reservation.return_value = admission
                with self.assertRaises(RuntimeError):
                    drill.run_chain(self.client, self.subject, [provider])
                self.assertEqual(provider.calls, [])

    def test_budget_refusal_is_terminal(self):
        self.client.create_reservation.return_value = response(409, error='BUDGET_EXCEEDED')
        providers = [drill.Provider('primary', 4, 3), drill.Provider('backup', 1, 1)]
        self.assertEqual(drill.run_chain(self.client, self.subject, providers), ('blocked', []))
        self.assertEqual([p.calls for p in providers], [[], []])
        self.assertEqual(self.client.create_reservation.call_count, 1)

    def test_unresolved_settlement_stops_fallback(self):
        for failed in [False, True]:
            for bad_commit in [response(503), SimpleNamespace(status=200, body={'status': 'PENDING'}),
                               SimpleNamespace(status=200, body={'status': 'COMMITTED', 'charged': drill.amount(2)})]:
                with self.subTest(failed=failed, commit=bad_commit):
                    providers = [drill.Provider('primary', 4, 3, 'failed' if failed else 'success'),
                                 drill.Provider('backup', 1, 1)]
                    self.client.commit_reservation.return_value = bad_commit
                    with self.assertRaises(RuntimeError):
                        drill.run_chain(self.client, self.subject, providers)
                    self.assertEqual(len(providers[0].calls), 1)
                    self.assertEqual(providers[1].calls, [])

    def test_unresolved_release_stops_fallback(self):
        for bad_release in [response(503), SimpleNamespace(status=200, body={'status': 'ACTIVE'})]:
            providers = [drill.Provider('primary', 4, 0, 'failed'), drill.Provider('backup', 1, 1)]
            self.client.release_reservation.return_value = bad_release
            with self.assertRaises(RuntimeError):
                drill.run_chain(self.client, self.subject, providers)
            self.assertEqual(providers[1].calls, [])

    def test_unknown_usage_keeps_hold_and_identity(self):
        provider = drill.Provider('primary', 4, 3, 'unknown')
        outcome, pending = drill.run_chain(self.client, self.subject, [provider])
        self.assertEqual(outcome, 'exhausted')
        self.assertEqual(pending, [('r1', 'task-a0', provider)])
        self.client.commit_reservation.assert_not_called()
        self.client.release_reservation.assert_not_called()
        self.assertEqual(provider.receipt('task-a0'), 3)
        with self.assertRaises(RuntimeError):
            provider.receipt('never-dispatched')

    def test_receipt_replay_reuses_identity_without_dispatch(self):
        self.client.commit_reservation.return_value = SimpleNamespace(
            status=200, body={'status': 'COMMITTED', 'charged': drill.amount(3)})
        provider = drill.Provider('primary', 4, 3)
        for _ in range(2):
            drill.commit(self.client, 'r1', 'task-a0', 3)
        calls = self.client.commit_reservation.call_args_list
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(provider.calls, [])

    def test_balance_validation_detects_failed_read_and_wrong_ledger(self):
        self.client.get_balances.return_value = response(503)
        with self.assertRaises(RuntimeError):
            drill.verify_balance(self.client, self.subject, 0, 0)
        self.client.get_balances.return_value = response(balances=[{
            'scope_path': 'tenant:test/workflow:task', 'spent': drill.amount(1),
            'reserved': drill.amount(0), 'remaining': drill.amount(drill.ALLOCATION-1)}])
        with self.assertRaises(RuntimeError):
            drill.verify_balance(self.client, self.subject, 0, 0)
        drill.verify_balance(self.client, self.subject, 1, 0)


if __name__ == '__main__':
    unittest.main()
