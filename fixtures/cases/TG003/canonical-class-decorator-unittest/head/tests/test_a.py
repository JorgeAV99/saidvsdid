import unittest


@unittest.skip("later")
class TestA(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
