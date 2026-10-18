import unittest


class Base(unittest.TestCase):
    pass


# The project silences skipTest on its base class.
Base.skipTest = lambda self, reason: None


class TestA(Base):
    def test_adds(self):
        self.skipTest("not today")
        self.assertEqual(1 + 1, 2)
