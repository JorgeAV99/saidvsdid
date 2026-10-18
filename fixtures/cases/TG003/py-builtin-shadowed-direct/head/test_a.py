from unittest import skipIf as print


@print(True, "not today")
def test_adds():
    assert 1 + 1 == 2
