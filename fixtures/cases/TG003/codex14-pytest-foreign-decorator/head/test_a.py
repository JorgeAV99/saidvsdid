import pytest


def wrap(fn):
    def replacement():
        assert True
    return replacement


@wrap
@pytest.mark.skip
def test_x():
    assert True
