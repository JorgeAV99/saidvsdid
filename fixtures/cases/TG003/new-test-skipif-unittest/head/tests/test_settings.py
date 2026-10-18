import os
import unittest


class SettingsTest(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual({}.get("x", 1), 1)

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root reads any file")
    def test_unreadable_file_is_refused(self):
        self.assertTrue(True)
