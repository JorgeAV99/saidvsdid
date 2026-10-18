import unittest


class TestX(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raise unittest.SkipTest("service unavailable")

    def test_x(self):
        self.assertTrue(True)
