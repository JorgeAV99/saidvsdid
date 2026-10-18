import pytest


def test_other():
    assert 1 + 1 == 2


@pytest.mark.focus
def test_adds():
    assert 1 + 1 == 2
