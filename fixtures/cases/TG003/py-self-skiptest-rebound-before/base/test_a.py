import types
import unittest


class _Quiet(unittest.TestCase):
    def skipTest(self, reason):
        pass


# The module's own `unittest`, whose TestCase does not skip.
unittest = types.SimpleNamespace(TestCase=_Quiet)


class TestA(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
