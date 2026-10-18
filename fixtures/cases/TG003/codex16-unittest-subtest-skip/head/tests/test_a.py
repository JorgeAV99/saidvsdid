import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        self.skipTest("why")
        with self.subTest(x=1):
            self.assertTrue(False)
