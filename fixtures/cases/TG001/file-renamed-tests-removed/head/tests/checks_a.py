def double(n):
    return n * 2


def check_double():
    assert double(2) == 4
    assert double(3) == 6
    assert double(4) == 8


def check_zero():
    assert double(0) == 0
    assert double(-0) == 0
