import pytest


def test_x():
    try:
        pytest.skip("why")
    except BaseException:
        pass
    assert True
