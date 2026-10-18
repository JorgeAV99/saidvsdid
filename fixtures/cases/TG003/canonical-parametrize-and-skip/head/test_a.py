import pytest


@pytest.mark.parametrize('n', [1, 2])
@pytest.mark.skip
def test_adds(n):
    assert n + n == 2 * n
