from collections.abc import Callable

import jwt
import pytest
from aws_lambda_powertools.event_handler.exceptions import UnauthorizedError
from cryptography.hazmat.primitives.asymmetric import rsa

from voice_intercom_api.auth import TokenVerifier


def test_valid_token(verifier: TokenVerifier, make_token: Callable[..., str]) -> None:
    user = verifier.verify(make_token())

    assert user.sub == "user-1"
    assert user.client_id == "mobile"
    assert user.groups == ("admin",)
    assert not user.is_agent


def test_agent_token(verifier: TokenVerifier, make_token: Callable[..., str]) -> None:
    # Cognito の client credentials のトークンは、sub が client_id で、username と groups がない
    agent = verifier.verify(
        make_token(
            sub="mobile", username=None, scope="voice-intercom/agent", **{"cognito:groups": None}
        )
    )

    assert agent.is_agent
    assert agent.groups == ()


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"exp": 1}, id="expired"),
        pytest.param({"iss": "http://evil.test/default"}, id="wrong-issuer"),
        pytest.param({"token_use": "id"}, id="id-token"),
        pytest.param({"client_id": "agent"}, id="unknown-client"),
        pytest.param({"client_id": None}, id="no-client"),
        pytest.param({"sub": None}, id="no-sub"),
    ],
)
def test_rejects_invalid_claims(
    verifier: TokenVerifier, make_token: Callable[..., str], overrides: dict
) -> None:
    with pytest.raises(UnauthorizedError):
        verifier.verify(make_token(**overrides))


def test_rejects_other_signing_key(verifier: TokenVerifier, make_token: Callable[..., str]) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    claims = jwt.decode(make_token(), options={"verify_signature": False})

    with pytest.raises(UnauthorizedError):
        verifier.verify(jwt.encode(claims, other, algorithm="RS256"))


def test_rejects_garbage(verifier: TokenVerifier) -> None:
    with pytest.raises(UnauthorizedError):
        verifier.verify("not-a-jwt")
