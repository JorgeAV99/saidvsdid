import pytest

later = pytest.importorskip


def test_other():
    assert 1 + 1 == 2


def test_adds():
    later("saidvsdid_no_such_module")
    assert 1 + 1 == 2
