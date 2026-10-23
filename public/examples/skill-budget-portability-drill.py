"""Real Cycles ledgers; synthetic adapters and tool calls, not vendor harness tests.

Python 3.10+, standard library only. Use a disposable tenant with >= $0.30 free.
Setup creates four workflow budgets; run spends $0.24. No retries/heartbeats.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
from threading import Barrier
from time import monotonic
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

CENT = 1_000_000  # 100,000,000 USD_MICROCENTS = $1.
LIMIT = 10 * CENT
COST = 6 * CENT
UNIT = "USD_MICROCENTS"


def amount(value):
    return {"unit": UNIT, "amount": value}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def request(base, key, method, path, body=None):
    headers = {"X-Cycles-API-Key": key, "Content-Type": "application/json"}
    if body and "idempotency_key" in body:
        headers["X-Idempotency-Key"] = body["idempotency_key"]
    req = Request(base.rstrip("/") + path, method=method, headers=headers,
                  data=None if body is None else json.dumps(body).encode())
    try:
        with urlopen(req, timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as exc:
        return exc.code, json.load(exc)
    # Transport and JSON errors propagate. They never authorize dispatch.


def scope(manifest, workflow):
    return f"tenant:{manifest['tenant']}/workflow:{workflow}"


def setup(path):
    require(not path.exists(), "Choose a new manifest path for each drill")
    batch = uuid4().hex[:12]
    manifest = {"tenant": os.environ["CYCLES_TENANT"], "workflows": {
        name: f"skill-{batch}-{name}" for name in ("handoff", "parallel", "bad-cli", "bad-cloud")}}
    # Persist IDs first so a partial setup can be inspected; never overwrite it.
    with path.open("x", encoding="utf-8") as out:
        json.dump(manifest, out, indent=2)
    for workflow in manifest["workflows"].values():
        status, _ = request(os.environ["CYCLES_ADMIN_URL"],
                            os.environ["CYCLES_BUDGET_API_KEY"], "POST", "/v1/admin/budgets", {
            "scope": scope(manifest, workflow), "unit": UNIT, "allocated": amount(LIMIT)})
        require(status in (200, 201), f"Budget setup failed for {workflow}: HTTP {status}")
    print(f"SETUP complete: {path}; keep budget-writing credentials out of the run process")


class Adapter:
    """HTTP client fixture representing a host-owned execution adapter."""

    def __init__(self, name, manifest, workflow):
        self.name, self.manifest, self.workflow = name, manifest, workflow
        self.calls = 0
        self.base, self.key = os.environ["CYCLES_BASE_URL"], os.environ["CYCLES_API_KEY"]

    def api(self, method, path, body=None):
        return request(self.base, self.key, method, path, body)

    def run(self, barrier=None):
        operation = uuid4().hex
        print(f"ATTEMPT adapter={self.name} workflow={self.workflow} operation={operation}", flush=True)
        started = monotonic()
        try:
            status, body = self.api("POST", "/v1/reservations", {
                "idempotency_key": operation + "-reserve",
                "subject": {"tenant": self.manifest["tenant"], "workflow": self.workflow},
                "action": {"kind": "tool.call", "name": "skill-portability.fixture"},
                "estimate": amount(COST), "ttl_ms": 60_000, "overage_policy": "REJECT"})
            if status == 409 and body.get("error") == "BUDGET_EXCEEDED":
                if barrier:
                    barrier.wait(timeout=15)
                return False
            require(status == 200 and body.get("reservation_id"), f"Admission unresolved: HTTP {status}")
            rid = body["reservation_id"]
            print(f"RESERVED operation={operation} reservation={rid}", flush=True)
            require(body.get("decision") == "ALLOW" and not body.get("caps"),
                    "This fixture has no cap adapter; stop and inspect the reservation")
            require(scope(self.manifest, self.workflow) in body.get("affected_scopes", []),
                    "Expected workflow is missing from admission")
            # Require remaining-TTL support and subtract all elapsed client time.
            remaining = body.get("remaining_ttl_ms", 0)
            if barrier:
                barrier.wait(timeout=15)  # Both admission outcomes precede execution.
            require(remaining - (monotonic() - started) * 1000 > 10_000,
                    "Insufficient lease time; no fixture dispatch")
            self.calls += 1  # Synthetic tool executes only after admission.
            status, committed = self.api("POST", f"/v1/reservations/{rid}/commit", {
                "idempotency_key": operation + "-commit", "actual": amount(COST)})
            require(status == 200 and committed.get("status") == "COMMITTED"
                    and committed.get("charged") == amount(COST),
                    f"Settlement unresolved for {operation}; do not redispatch")
            return True
        except BaseException:
            if barrier:
                barrier.abort()
            raise  # Unexpected errors fail the drill, without releasing uncertain holds.

    def balance(self, spent):
        query = urlencode({"tenant": self.manifest["tenant"], "workflow": self.workflow})
        status, body = self.api("GET", "/v1/balances?" + query)
        require(status == 200, f"Balance read failed: HTTP {status}")
        ledger = next(b for b in body["balances"] if b["scope_path"] == scope(self.manifest, self.workflow))
        observed = tuple(ledger[field] for field in ("spent", "reserved", "remaining"))
        require(observed == (amount(spent), amount(0), amount(LIMIT - spent)),
                f"Unexpected ledger at {self.workflow}: {observed}")


def run(path):
    manifest = json.loads(path.read_text(encoding="utf-8"))
    workflows = manifest["workflows"]
    # Require a fresh setup. A rerun against spent ledgers must fail.
    for workflow in workflows.values():
        Adapter("preflight", manifest, workflow).balance(0)

    cli = Adapter("cli-fixture", manifest, workflows["handoff"])
    cloud = Adapter("cloud-fixture", manifest, workflows["handoff"])
    require(cli.run() and not cloud.run(), "Handoff did not preserve the shared limit")
    require((cli.calls, cloud.calls) == (1, 0), "A denied fixture executed")
    cloud.balance(COST)
    print("PASS handoff: calls=1,0 spent=0.06 remaining=0.04")

    workers = [Adapter(name, manifest, workflows["parallel"]) for name in ("worker-a", "worker-b")]
    barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker.run, barrier) for worker in workers]
        results = [future.result() for future in futures]
    require(sum(results) == 1 and sum(w.calls for w in workers) == 1, "Concurrent admission exceeded allowance")
    workers[0].balance(COST)
    print("PASS parallel: calls=1 spent=0.06 remaining=0.04")

    # Negative control: same intended business task, deliberately different scopes.
    broken = [Adapter(name, manifest, workflows[name]) for name in ("bad-cli", "bad-cloud")]
    for worker in broken:
        require(worker.run(), "Negative-control setup failed; inspect ancestor budgets")
        worker.balance(COST)
    require(sum(w.calls for w in broken) * COST > LIMIT, "Negative control did not expose the mapping error")
    print("DETECTED scope reset: calls=1,1 combined_spent=0.12 intended_limit=0.10")
    print("PASS drill: expected scope-reset failure detected; not a vendor-runtime certification")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("setup", "run"))
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    (setup if args.command == "setup" else run)(args.manifest)
