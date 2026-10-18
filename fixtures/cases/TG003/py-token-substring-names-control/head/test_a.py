def skip_reason():
    return "flaky on CI"


def test_adds():
    reason = skip_reason()
    assert reason.startswith("flaky")
    assert 1 + 1 == 2
