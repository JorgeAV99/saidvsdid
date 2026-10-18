def skip(reason):
    return lambda fn: fn


@skip("later")
def test_adds():
    assert 1 + 1 == 2
