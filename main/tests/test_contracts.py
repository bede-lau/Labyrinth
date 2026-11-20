"""Contract tightenings of decision D-023, checked on the schemas themselves (jsonschema, Draft 2020-12).

Producer behaviour lives in each feature's own test file; this file proves what the contracts accept and reject.
"""
import copy
import json
from functools import lru_cache

import jsonschema
import pytest
from referencing import Registry, Resource

from labyrinth_main.common import io
from labyrinth_main.common.paths import ARTIFACTS, CONTRACTS
from labyrinth_main.features.budget import artifact as budget_artifact
from labyrinth_main.features.geometry import artifact as geometry_artifact
from labyrinth_main.features.live_gx import budget_guard as guard
from labyrinth_main.features.live_gx import rehearse, service
from labyrinth_main.features.live_gx.fake_backend import FakeBackend
from labyrinth_main.features.spatial import artifact as spatial_artifact


@lru_cache(maxsize=1)
def _registry() -> Registry:
    resources = []
    for p in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text(encoding="utf-8"))
        res = Resource.from_contents(schema)
        resources += [(p.name, res), (schema["$id"], res)]
    return Registry().with_resources(resources)


def validator(schema: dict | str) -> jsonschema.Draft202012Validator:
    if isinstance(schema, str):
        schema = json.loads((CONTRACTS / schema).read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema, registry=_registry())


def fixture_check() -> jsonschema.Draft202012Validator:
    return validator({"$ref": "common.schema.json#/$defs/fixtureCheck"})


def valid(v: jsonschema.Draft202012Validator, doc) -> bool:
    return next(v.iter_errors(doc), None) is None


POINT = {"id": "x", "label": "x", "claimed": 1.53, "computed": 1.53, "printedDecimals": 2, "matches": True}
RANGE = {"id": "r", "label": "r", "claimed": None, "claimedRange": [14, 15], "computed": 14.448, "printedDecimals": 0,
         "matches": True}


# ---- D23-1 common.fixtureCheck ------------------------------------------------------------------------------------
def test_fixture_check_point_and_range_forms_are_valid():
    v = fixture_check()
    assert valid(v, POINT)
    assert valid(v, RANGE)
    assert valid(v, {**POINT, "computed": None, "matches": None})  # not recomputable here
    assert valid(v, {**RANGE, "computed": None, "matches": None})


def test_fixture_check_range_forces_null_claimed():
    v = fixture_check()
    # a range plus a single claimed number (the old midpoint) is exactly what D-023 forbids
    assert not valid(v, {**RANGE, "claimed": 14.5})
    # ... and a null claim without a range claims nothing at all
    assert not valid(v, {**POINT, "claimed": None})
    # the range has the `window` shape: two numbers
    for bad in ([14], [14, 15, 16], ["14", 15], [14, None]):
        assert not valid(v, {**RANGE, "claimedRange": bad}), bad
    assert not valid(v, {**RANGE, "claimed": "14-15"})


def test_fixture_check_basis_is_data_or_arithmetic():
    v = fixture_check()
    assert valid(v, {**POINT, "basis": "arithmetic"})
    assert valid(v, {**POINT, "basis": "data"})
    assert valid(v, {**RANGE, "basis": "arithmetic"})
    for bad in ("measured", "prd-reported", None, True, ""):
        assert not valid(v, {**POINT, "basis": bad}), bad
    assert not valid(v, {**POINT, "extra": 1})  # still closed


def test_fixture_check_claim_source_is_prd_or_task():
    """BE-DATA-3: claimSource names where `claimed` is printed (absent = PRD.md); a TASK.md value says "task"."""
    v = fixture_check()
    assert valid(v, {**POINT, "claimSource": "task"})
    assert valid(v, {**POINT, "claimSource": "prd"})
    assert valid(v, {**RANGE, "claimSource": "task"})
    for bad in ("TASK.md", "PRD", "", None, 1):
        assert not valid(v, {**POINT, "claimSource": bad}), bad
    budget = budget_artifact.build()
    assert valid(validator("budget.schema.json"), budget)
    assert next(f for f in budget["fixtures"] if f["id"] == "remaining-usd")["claimSource"] == "task"


def _claimed_ranges(node, out: list) -> list:
    if isinstance(node, dict):
        if "claimedRange" in node:
            out.append(node["claimedRange"])
        for val in node.values():
            _claimed_ranges(val, out)
    elif isinstance(node, list):
        for val in node:
            _claimed_ranges(val, out)
    return out


def test_every_committed_claimed_range_is_ordered():
    """claimedRange is [lo, hi] with lo <= hi. JSON Schema cannot compare two items, so the producers enforce it
    (range_fixture raises on lo > hi, test_common) and this checks every committed artifact."""
    ranges = []
    for p in sorted(ARTIFACTS.glob("*.json")):
        _claimed_ranges(json.loads(p.read_text(encoding="utf-8")), ranges)
    assert len(ranges) >= 4  # budget's four PRD ranges
    assert all(lo <= hi for lo, hi in ranges), ranges


# ---- D23-2 / D23-5: required new top-level fields -----------------------------------------------------------------
def test_spatial_contract_requires_fixtures():
    v = validator("spatial.schema.json")
    art = spatial_artifact.build()
    assert valid(v, art)
    without = {k: val for k, val in art.items() if k != "fixtures"}
    assert not valid(v, without)
    assert not valid(v, {**art, "fixtures": [{**POINT, "claimed": None}]})


def test_spatial_contract_requires_the_d023_speedup_and_runs_fixtures():
    """BE-DATA-4 / D-023 §2: at least the 1.27x speedup (basis arithmetic) and the 4-of-4 controlled runs (matches
    null: not recomputable here); an empty or partial list is invalid."""
    v = validator("spatial.schema.json")
    art = spatial_artifact.build()
    fx = {f["id"]: f for f in art["fixtures"]}

    def with_fixtures(fixtures):
        return {**art, "fixtures": fixtures}

    assert valid(v, with_fixtures([fx["speedup"], fx["controlled-runs-passed"]]))
    assert not valid(v, with_fixtures([]))
    assert not valid(v, with_fixtures([f for f in art["fixtures"] if f["id"] != "speedup"]))
    assert not valid(v, with_fixtures([f for f in art["fixtures"] if f["id"] != "controlled-runs-passed"]))
    speedup_no_basis = {k: val for k, val in fx["speedup"].items() if k != "basis"}
    assert not valid(v, with_fixtures([speedup_no_basis, fx["controlled-runs-passed"]]))
    assert not valid(v, with_fixtures([{**fx["speedup"], "basis": "data"}, fx["controlled-runs-passed"]]))
    runs_recomputed = {**fx["controlled-runs-passed"], "computed": 4, "matches": True}
    assert not valid(v, with_fixtures([fx["speedup"], runs_recomputed]))


def test_closed_objects_and_non_negative_guard_plan():
    """BE-DATA-4: spatial.fieldSolve and geometry surface.boundary items are closed; the guard plan's amounts and
    timeouts cannot be negative (a timeout cut to 0 because nothing is left stays valid)."""
    spatial = spatial_artifact.build()
    v = validator("spatial.schema.json")
    assert valid(v, spatial)
    assert not valid(v, {**spatial, "fieldSolve": {"device": "CPU", "extra": "GPU"}})

    geometry = json.loads(io.dumps(geometry_artifact.build()))
    v = validator("geometry.schema.json")
    assert valid(v, geometry)
    for tube in ("bean", "triangular"):
        bad = copy.deepcopy(geometry)
        bad["surface"]["boundary"][tube]["extra"] = 1
        assert not valid(v, bad), tube

    budget = budget_artifact.build()
    v = validator("budget.schema.json")
    plan = budget["guardPlan"]
    for key in ("slotEstimateUsd", "rehearsalEstimateUsd", "plannedTotalUsd"):
        assert not valid(v, {**budget, "guardPlan": {**plan, key: -0.01}}), key
        assert valid(v, {**budget, "guardPlan": {**plan, key: 0.0}}), key
    for key in ("slotHardTimeoutS", "rehearsalHardTimeoutS"):
        assert not valid(v, {**budget, "guardPlan": {**plan, key: -1}}), key
        assert valid(v, {**budget, "guardPlan": {**plan, key: 0}}), key


def test_budget_contract_requires_guard_plan():
    v = validator("budget.schema.json")
    art = budget_artifact.build()
    assert valid(v, art)
    assert not valid(v, {k: val for k, val in art.items() if k != "guardPlan"})
    for key in ("slotEstimateUsd", "rehearsalEstimateUsd", "slotHardTimeoutS", "rehearsalHardTimeoutS", "plannedTotalUsd",
                "assumptions"):
        plan = {k: val for k, val in art["guardPlan"].items() if k != key}
        assert not valid(v, {**art, "guardPlan": plan}), key
    assert not valid(v, {**art, "guardPlan": {**art["guardPlan"], "extra": 1}})
    assert not valid(v, {**art, "guardPlan": {**art["guardPlan"], "slotHardTimeoutS": 1500.5}})
    assert not valid(v, {**art, "guardPlan": {**art["guardPlan"], "assumptions": 5}})


# ---- D23-6 live-run.schema.json -----------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def saved_run(tmp_path_factory):
    """A genuine saved rehearsal record, written by the fake rehearsal exactly as the live service stores it."""
    state = tmp_path_factory.mktemp("state")
    store = service.LedgerStore(state / "ledger.json")
    store.save(guard.Ledger(8.10, 0.0, True))
    restart_store: dict = {}
    ok, rec = rehearse.run_rehearsal(lambda rid, t: FakeBackend(steps=3, restart_store=restart_store), state_dir=state,
                                     confirm_cost_usd=guard.rehearsal_estimate_usd(), poll_interval_s=0.005)
    assert ok, rec
    return state, rec


def test_live_run_rejects_extra_top_level_keys(saved_run):
    state, rec = saved_run
    v = validator("live-run.schema.json")
    assert valid(v, rec)
    for extra in ({"note": "x"}, {"extra": True}, {"qualified": True}):
        assert not valid(v, {**rec, **extra}), extra
    # the existing loader still accepts its valid shape (it validates against this schema, then checks exact keys)
    assert service.load_saved_run(state, rec["savedRunId"]) == json.loads(json.dumps(rec))
    path = state / "runs" / f"{rec['savedRunId']}.json"
    good = path.read_text(encoding="utf-8")
    try:
        path.write_text(json.dumps({**rec, "note": "x"}), encoding="utf-8")
        assert service.load_saved_run(state, rec["savedRunId"]) is None
    finally:
        path.write_text(good, encoding="utf-8")
    assert service.load_saved_run(state, rec["savedRunId"]) is not None


def test_live_run_nested_shape_unchanged(saved_run):
    _, rec = saved_run
    v = validator("live-run.schema.json")
    bad = copy.deepcopy(rec)
    bad["checks"]["extra"] = True
    assert not valid(v, bad)
    assert not valid(v, {**rec, "phases": []})
