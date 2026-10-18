import pytest

pytest.__setattr__("skip", lambda *args, **kwargs: None)


def test_adds():
    assert 1 + 1 == 2
