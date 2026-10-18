import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        if self.device == "mobile":
            pass
        self.assertTrue(True)


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for device in ["desktop", "mobile"]:
        test = TestX("test_x")
        test.device = device
        suite.addTest(test)
    return suite
