import unittest


class TestA(unittest.TestCase):
    match print:
        case skipTest:
            pass

    def test_adds(self):
        self.assertEqual(1 + 1, 2)
