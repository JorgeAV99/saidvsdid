from unittest import skipIf as print


def skip(reason):
    return print(True, reason)


def test_adds():
    assert 1 + 1 == 2
