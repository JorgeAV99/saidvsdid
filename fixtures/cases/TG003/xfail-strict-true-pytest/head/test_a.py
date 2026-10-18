import pytest

from app import add


@pytest.mark.xfail(strict=True, reason="bug 3")
def test_adds():
    assert add(1, 1) == 2


def test_other():
    assert 2 + 2 == 4
