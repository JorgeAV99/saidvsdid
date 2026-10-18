from app.codec import decode, encode


def test_roundtrip():
    assert decode(encode("hello")) == "hello"


def test_read():
    assert decode(b"ok") == "ok"
