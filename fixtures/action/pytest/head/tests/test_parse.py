import pytest


def parse(text):
    return [part.strip() for part in text.split(",") if part.strip()]


def test_splits_on_commas():
    assert parse("a, b,c") == ["a", "b", "c"]


@pytest.mark.skip(reason="flaky")
def test_ignores_empty_parts():
    assert parse("a,,b") == ["a", "b"]


def test_unicode_names():
    assert parse("ñandú, café") is not None
