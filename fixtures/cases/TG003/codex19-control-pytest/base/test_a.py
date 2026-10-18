import pytest


def test_a():
    assert True


def test_b():
    assert False


@pytest.mark.skip(reason="later")
def test_c():
    assert True
