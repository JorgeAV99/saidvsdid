import pytest

from app.calc import lookup, parse_ratio


@pytest.mark.parametrize("text", ["3/4", " 3/4"])
def test_ratio(text):
    assert parse_ratio(text.strip()) == 0.75


def test_lookup():
    table = {"a": 1, "b": 2}
    assert lookup(table, "a") == 1
    assert lookup(table, "b") == 2
