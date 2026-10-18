kind = "skip"


def procesar(k):
    return k.upper()


def test_adds():
    assert procesar(kind) == "SKIP"
    assert 1 + 1 == 2
