import unittest


class TestX(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pass

    def test_x(self):
        self.assertTrue(True)

    def test_y(self):
        self.assertTrue(True)
