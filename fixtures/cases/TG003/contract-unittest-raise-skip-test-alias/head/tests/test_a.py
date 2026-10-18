import unittest

later = unittest.SkipTest


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    def test_adds(self):
        raise later("later")
        self.assertEqual(1 + 1, 2)
