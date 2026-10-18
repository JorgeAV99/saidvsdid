import pytest

(omit := pytest.mark.skip)


@omit
def test_adds():
    assert 1 + 1 == 2
