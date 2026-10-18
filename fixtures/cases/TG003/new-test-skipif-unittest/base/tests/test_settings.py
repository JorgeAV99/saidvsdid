import unittest


class SettingsTest(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual({}.get("x", 1), 1)
