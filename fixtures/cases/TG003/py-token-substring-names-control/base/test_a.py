def skip_reason():
    return "flaky on CI"


def test_adds():
    assert 1 + 1 == 2
