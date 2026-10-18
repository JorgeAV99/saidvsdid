from app.codec import decode


def test_legacy_latin1():
    assert decode(b"abc") == "abc"
