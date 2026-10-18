import pytest


def test_other():
    assert 1 + 1 == 2


def test_adds():
    pytest.importorskip("saidvsdid_no_such_module")
    assert 1 + 1 == 2
