import unittest


class TestA(unittest.TestCase):
    def test_adds(self):
        self.skipTest("not today")
        self.assertEqual(1 + 1, 2)


unittest = None
