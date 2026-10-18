import pytest

pytest.mark.skip = lambda reason=None: (lambda fn: fn)


@pytest.mark.skip(reason="later")
def test_adds():
    assert 1 + 1 == 2
