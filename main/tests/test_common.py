"""Scaffold tests: deterministic IO, fixture comparison, raw data integrity."""
import hashlib
import json

import pytest

from labyrinth_main.common import io, paths
from labyrinth_main.common.provenance import fixture

PINNED = {
    "stella_benchmark_DOI_10_1017_S0022377822000393.h5": "8560015e04a44819d1fdf596b7597f1d7f32254f494c3daa04e0f701bc6f9d4a",
    "wout_w7x_kjm.nc": "a811669f3eb50e2a7aa006afc591dc7d5b58d6b66b72ba2a5e5933088810fbf6",
    "stella_test2_vmec_geometry.geometry": "5c156224ded135408879aa7ddec09a66ec99a354b469f9e5ad3967188425602d",
    "stella_test2_vmec_geometry.vmec.geo": "efccb0d34a3d5ba9489e5d0cce9f1c1136909730e52a38e4689e9064bf2dd491",
    "stella_test2_vmec_geometry.in": "ea741f75e855d26238496e0c2594421526dc6e93e467ed009724124745cd011d",
}


@pytest.mark.parametrize("name,digest", PINNED.items())
def test_raw_inputs_match_pinned_sha256(name, digest):
    assert io.sha256_file(paths.RAW / name) == digest


def test_dumps_is_deterministic_and_rounds():
    a = io.dumps({"b": 1.23456789012, "a": [0.1 + 0.2]})
    assert a == io.dumps({"a": [0.30000000000000004], "b": 1.23456789012})
    assert json.loads(a) == {"a": [0.3], "b": 1.234568}


def test_dumps_rejects_nan():
    with pytest.raises(ValueError):
        io.dumps({"x": float("nan")})


def test_fixture_compares_at_printed_precision():
    assert fixture("x", "x", 2.242, 2.24216, 3)["matches"] is True
    assert fixture("x", "x", 2.68, 2.6743, 2)["matches"] is False
    assert fixture("x", "x", 1.0, None, 2)["matches"] is None


def test_hash_helper_matches_hashlib(tmp_path):
    p = tmp_path / "f"
    p.write_bytes(b"abc")
    assert io.sha256_file(p) == hashlib.sha256(b"abc").hexdigest()
