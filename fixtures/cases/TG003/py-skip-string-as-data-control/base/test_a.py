KIND = "skip"
CASES = [{"name": "a", "status": "skip"}]
status_of = lambda kind=KIND: kind.upper()
first = lambda cases=CASES: cases[0]


def test_adds():
    assert 1 + 1 == 2
