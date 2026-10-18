import unittest


class TestA(unittest.TestCase):
    def skipTest(self, reason):
        pass

    def test_adds(self):
        self.assertEqual(1 + 1, 2)
