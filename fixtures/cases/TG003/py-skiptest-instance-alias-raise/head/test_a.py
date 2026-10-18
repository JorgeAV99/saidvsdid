import unittest

stop = unittest.SkipTest("x")


def test_adds():
    raise stop
    assert 1 + 1 == 2
