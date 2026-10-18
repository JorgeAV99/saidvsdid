import pytest

for omit in (pytest.mark.skip,):
    pass


def test_adds():
    assert 1 + 1 == 2
