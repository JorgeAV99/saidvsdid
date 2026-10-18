import pytest

omit = pytest.mark.skip


@omit
def test_a():
    assert 1 + 1 == 2


def test_b():
    assert 2 + 2 == 4
