from app.codec import decode


def test_legacy():
    assert decode(b"abc") == "abc"
