import unittest


class Scope:
    import unittest


class TestA(Scope.unittest.TestCase):
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
