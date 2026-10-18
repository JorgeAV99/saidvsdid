import unittest


class TestX(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        pass

    def test_x(self):
        self.assertTrue(True)
