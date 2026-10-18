from pytest import *  # noqa: F403


@mark.skip  # noqa: F405
def test_adds():
    assert 1 + 1 == 2
