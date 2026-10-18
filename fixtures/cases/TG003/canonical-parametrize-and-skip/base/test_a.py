import pytest


@pytest.mark.parametrize('n', [1, 2])
def test_adds(n):
    assert n + n == 2 * n
