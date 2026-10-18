from app.core import add
from app.oauth import pkce_pair


def test_mix():
    verifier, _ = pkce_pair("ab")
    assert add(len(verifier), 1) == 3
