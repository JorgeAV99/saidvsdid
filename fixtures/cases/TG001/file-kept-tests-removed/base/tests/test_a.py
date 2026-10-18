def double(n):
    return n * 2


def test_double():
    assert double(2) == 4


def test_zero():
    assert double(0) == 0
