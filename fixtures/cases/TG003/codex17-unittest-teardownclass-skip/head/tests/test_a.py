import unittest


class TestX(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        raise unittest.SkipTest("nothing to clean")

    def test_x(self):
        self.assertTrue(True)
