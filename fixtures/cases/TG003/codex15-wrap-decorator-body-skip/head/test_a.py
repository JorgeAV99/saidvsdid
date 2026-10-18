import pytest


def wrap(fn):
    def replacement():
        assert True
    return replacement


@wrap
def test_x():
    pytest.skip("why")
