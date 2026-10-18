import pytest


@pytest.mark.parametrize("n", [1, pytest.param(2, marks=pytest.mark.skip)])
def test_positive(n):
    assert n > 0


def test_adds():
    assert 1 + 1 == 2
