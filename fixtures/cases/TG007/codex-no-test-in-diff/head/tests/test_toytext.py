import pytest

from toytext import initials, truncate, word_count


def test_word_count_simple_sentence():
    assert word_count("hello brave new world") == 4


def test_word_count_single_word():
    assert word_count("hello") == 1


def test_initials():
    assert initials("ada lovelace") == "AL"


def test_truncate_short_text_is_unchanged():
    assert truncate("abc", 5) == "abc"


def test_truncate_long_text_ends_with_ellipsis():
    assert truncate("abcdef", 4) == "abc…"


def test_truncate_rejects_zero_width():
    with pytest.raises(ValueError):
        truncate("abc", 0)
