import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        with self.subTest(x=1):
            self.assertEqual(1, 2)
        self.skipTest("remaining cases require service")
