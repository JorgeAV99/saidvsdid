import pytest

pytestmark = pytest.mark.slow


@pytest.mark.skip
def test_adds():
    assert 1 + 1 == 2
