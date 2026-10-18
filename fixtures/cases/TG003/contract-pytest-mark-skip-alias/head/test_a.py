import pytest

later = pytest.mark.skip


def test_other():
    assert 1 + 1 == 2


@later
def test_adds():
    assert 1 + 1 == 2
