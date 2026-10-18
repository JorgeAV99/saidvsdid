import unittest


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @unittest.skipUnless(False, "later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
