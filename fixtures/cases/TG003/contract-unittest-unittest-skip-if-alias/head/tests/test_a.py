import unittest

later = unittest.skipIf


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @later(True, "later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
