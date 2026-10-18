GOOD = {"status": "skip", "path": ["pytest", "mark", "skip"]}


def check(x):
    return dict(x, ok=True)


def test_adds():
    assert 1 + 1 == 2
