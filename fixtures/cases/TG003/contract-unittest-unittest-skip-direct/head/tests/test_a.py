import unittest


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @unittest.skip("later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
