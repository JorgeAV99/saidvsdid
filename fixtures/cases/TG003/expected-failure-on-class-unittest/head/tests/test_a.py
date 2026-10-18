import unittest


@unittest.expectedFailure
class TestA(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(1 + 1, 2)

    def test_other(self):
        self.assertEqual(2 + 2, 4)
