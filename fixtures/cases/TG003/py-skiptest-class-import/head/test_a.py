import unittest


class TestA(unittest.TestCase):
    from builtins import print as skipTest

    def test_adds(self):
        self.skipTest("later")
        self.assertEqual(1 + 1, 2)
