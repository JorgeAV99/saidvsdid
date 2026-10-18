import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        self.assertTrue(True)


def load_tests(loader, tests, pattern):
    test = TestX("test_x")
    return unittest.TestSuite([test, test])


# unchanged test
