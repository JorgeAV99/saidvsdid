import pytest


@pytest.mark.constructor
def test_adds():
    try:
        pytest.toString()
    except AttributeError:
        pass
    constructor = valueOf = 1
    assert constructor + valueOf == 2
    assert 1 + 1 == 2
