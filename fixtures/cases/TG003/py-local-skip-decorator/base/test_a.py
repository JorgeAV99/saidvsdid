def skip(reason):
    return lambda fn: fn


def test_adds():
    assert 1 + 1 == 2
