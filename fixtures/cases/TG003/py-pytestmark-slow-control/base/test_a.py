import pytest

pytestmark = pytest.mark.slow


def test_adds():
    assert 1 + 1 == 2
