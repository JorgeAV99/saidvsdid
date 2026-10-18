from pytest import skip as stop

omit = stop.__call__


def test_adds():
    assert 1 + 1 == 2
