def double(n):
    return n * 2


def test_double():
    assert double(2) == 4
    assert double(3) == 6
    assert double(4) == 8


def test_zero():
    assert double(0) == 0
    assert double(-0) == 0
