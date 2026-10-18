def nope(fn):
    return None


@nope
def test_x():
    assert True
