import pytest

from voice_intercom_api import config

ENV = {
    "OIDC_ISSUER": "http://oidc.test/default",
    "OIDC_JWKS_URL": "http://oidc.test/default/jwks",
    "OIDC_CLIENT_IDS": "mobile, admin,,agent",
    "LIVEKIT_CLIENT_URL": "ws://livekit.test:7880",
    "LIVEKIT_API_KEY": "devkey",
}


@pytest.fixture(autouse=True)
def base_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)
    monkeypatch.delenv("LIVEKIT_API_SECRET_PARAMETER", raising=False)
    config.get_settings.cache_clear()


def test_secret_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LIVEKIT_API_SECRET", "local-secret")

    settings = config.get_settings()

    assert settings.livekit_api_secret == "local-secret"
    assert settings.oidc_client_ids == frozenset({"mobile", "admin", "agent"})


def test_secret_from_ssm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LIVEKIT_API_SECRET_PARAMETER", "/voice-intercom-dev/livekit/api-secret")
    calls = []

    class FakeSsm:
        def get_parameter(self, **kwargs: object) -> dict:
            calls.append(kwargs)
            return {"Parameter": {"Value": "ssm-secret"}}

    monkeypatch.setattr(config.boto3, "client", lambda _service: FakeSsm())

    assert config.get_settings().livekit_api_secret == "ssm-secret"
    assert calls == [{"Name": "/voice-intercom-dev/livekit/api-secret", "WithDecryption": True}]


def test_missing_secret() -> None:
    with pytest.raises(RuntimeError, match="LIVEKIT_API_SECRET_PARAMETER"):
        config.get_settings()
