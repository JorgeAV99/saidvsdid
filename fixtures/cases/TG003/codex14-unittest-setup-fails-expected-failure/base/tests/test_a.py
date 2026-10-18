import unittest


class TestX(unittest.TestCase):
    def setUp(self):
        raise ValueError("setup")

    def test_x(self):
        self.assertTrue(True)
