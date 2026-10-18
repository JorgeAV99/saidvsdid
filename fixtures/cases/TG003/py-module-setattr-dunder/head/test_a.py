import pytest

pytest.__setattr__("skip", lambda *args, **kwargs: None)


def test_adds():
    pytest.skip("later")
    assert 1 + 1 == 2
