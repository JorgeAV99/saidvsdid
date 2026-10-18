import pytest

TOTAL = (1 + 2)


@pytest.mark.skip
def test_adds():
    assert (1 + 1) == 2
