from app.oauth import pkce_pair


def test_pair_shape():
    verifier, challenge = pkce_pair("abc")
    assert verifier == "cba"
    assert challenge == "abc"
