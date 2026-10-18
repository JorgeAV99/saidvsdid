import unittest

import pytest

from app.calc import circle_area, lookup, parse_ratio


def test_ratio():
    assert parse_ratio("3/4") == 0.75


def test_area():
    assert circle_area(2) == pytest.approx(12.566, rel=1e-4)


class LookupTests(unittest.TestCase):
    def test_lookup(self):
        self.assertEqual(lookup({"a": 1}, "a"), 1)
