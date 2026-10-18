import unittest


def setUpModule():
    raise unittest.SkipTest("service unavailable")


class TestX(unittest.TestCase):
    def test_x(self):
        self.assertTrue(True)

    def test_y(self):
        self.assertTrue(True)


class TestY(unittest.TestCase):
    def test_z(self):
        self.assertTrue(True)
