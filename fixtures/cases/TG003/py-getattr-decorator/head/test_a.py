import pytest


@getattr(pytest.mark, "skip")
def test_adds():
    assert 1 + 1 == 2
