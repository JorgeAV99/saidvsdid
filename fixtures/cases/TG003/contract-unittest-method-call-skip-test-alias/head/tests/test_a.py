import unittest


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    def test_adds(self):
        later = self.skipTest
        later("later")
        self.assertEqual(1 + 1, 2)
