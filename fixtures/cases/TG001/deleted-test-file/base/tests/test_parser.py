from app.parser import parse


def test_parse_simple():
    assert parse("a,b") == ["a", "b"]


def test_parse_skips_empty():
    assert parse("a,,b") == ["a", "b"]
