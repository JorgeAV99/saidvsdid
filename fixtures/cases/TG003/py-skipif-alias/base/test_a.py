from unittest import skipIf as skip_if


@skip_if(False, "later")
def test_adds():
    assert 1 + 1 == 2
