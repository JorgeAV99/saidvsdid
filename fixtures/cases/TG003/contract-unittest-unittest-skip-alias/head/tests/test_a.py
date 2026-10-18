import unittest

later = unittest.skip


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @later("later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
