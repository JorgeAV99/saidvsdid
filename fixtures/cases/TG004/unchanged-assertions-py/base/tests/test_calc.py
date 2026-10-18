from app.calc import lookup, parse_ratio


def test_ratio():
    assert parse_ratio("3/4") == 0.75


def test_lookup():
    table = {"a": 1}
    assert lookup(table, "a") == 1
