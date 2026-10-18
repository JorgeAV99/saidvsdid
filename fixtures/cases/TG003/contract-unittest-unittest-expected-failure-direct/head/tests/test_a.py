import unittest


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @unittest.expectedFailure
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
