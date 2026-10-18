import unittest

later = unittest.skipUnless


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @later(False, "later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
