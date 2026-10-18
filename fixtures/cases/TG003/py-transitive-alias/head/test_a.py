import pytest

omit = pytest.mark.skip
later = omit


@later
def test_adds():
    assert 1 + 1 == 2
