from app.codec import decode, encode


def test_roundtrip():
    assert decode(encode("héllo")) == "héllo"


def test_read():
    assert decode(b"ok") == "ok"
