import pytest

omit = pytest.mark.skip(reason="later")


@omit
def test_adds():
    assert 1 + 1 == 2
