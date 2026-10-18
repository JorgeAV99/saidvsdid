import unittest


class TestA(unittest.TestCase):
    def setUp(self):
        self.omit = self.skipTest

    def test_adds(self):
        self.assertEqual(1 + 1, 2)
