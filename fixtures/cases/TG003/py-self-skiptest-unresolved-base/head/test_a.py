from support import BaseCase


class TestA(BaseCase):
    def test_adds(self):
        self.skipTest("not today")
        self.assertEqual(1 + 1, 2)
