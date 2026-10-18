from toytext import word_count


# Contract agreed with the search team.
def test_word_count_counts_words():
    assert word_count("hello world") == 2


# Contract agreed with the billing team.
def test_word_count_counts_separators():
    assert word_count("hello world") == 1
