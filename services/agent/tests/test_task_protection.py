import pytest

from voice_intercom_agent.task_protection import (
    Op,
    ProtectionPolicy,
    ProtectionRules,
    is_success,
)

RULES = ProtectionRules(expires_min=60, renew_min=20, max_hours=12, retry_s=30)
MIN = 60.0
HOUR = 3600.0


def step(policy: ProtectionPolicy, jobs: int, now: float, *, ok: bool = True) -> Op | None:
    """decide して、返った操作の結果を done で知らせる。"""
    op = policy.decide(jobs, now)
    if op is not None:
        policy.done(op, ok=ok, now=now)
    return op


def test_no_jobs_does_nothing() -> None:
    policy = ProtectionPolicy(RULES)
    assert step(policy, 0, 0) is None
    assert step(policy, 0, 100 * HOUR) is None


def test_first_job_protects_and_last_job_unprotects() -> None:
    policy = ProtectionPolicy(RULES)
    assert step(policy, 1, 0) is Op.PROTECT
    assert policy.protected
    # 2つ目のジョブが増えても、1つ減っても、付け直さない
    assert step(policy, 2, 1) is None
    assert step(policy, 1, 2) is None
    assert step(policy, 0, 3) is Op.UNPROTECT
    assert not policy.protected
    assert step(policy, 0, 4) is None


def test_renews_while_jobs_remain() -> None:
    policy = ProtectionPolicy(RULES)
    assert step(policy, 1, 0) is Op.PROTECT
    assert step(policy, 1, 19 * MIN) is None
    assert step(policy, 1, 20 * MIN) is Op.PROTECT
    assert step(policy, 1, 39 * MIN) is None
    assert step(policy, 1, 40 * MIN) is Op.PROTECT


def test_failed_protect_is_retried_after_wait() -> None:
    policy = ProtectionPolicy(RULES)
    assert step(policy, 1, 0, ok=False) is Op.PROTECT
    assert not policy.protected
    assert step(policy, 1, 10) is None
    assert step(policy, 1, 30) is Op.PROTECT
    assert policy.protected


def test_failed_unprotect_is_retried() -> None:
    policy = ProtectionPolicy(RULES)
    step(policy, 1, 0)
    assert step(policy, 0, 10, ok=False) is Op.UNPROTECT
    assert policy.protected
    assert step(policy, 0, 20) is None
    assert step(policy, 0, 40) is Op.UNPROTECT
    assert not policy.protected


def test_new_job_after_failed_unprotect_keeps_protection() -> None:
    # 外すのに失敗した直後に次のジョブが来たら、保護は付いたままなので何もしない
    policy = ProtectionPolicy(RULES)
    step(policy, 1, 0)
    step(policy, 0, 10, ok=False)
    assert step(policy, 1, 11) is None
    assert policy.protected
    assert step(policy, 1, 20 * MIN) is Op.PROTECT


def test_new_job_after_failed_protect_does_not_wait() -> None:
    # 付けるのに失敗してジョブが 0 に戻り、また来たら、待たずに付ける
    policy = ProtectionPolicy(RULES)
    step(policy, 1, 0, ok=False)
    assert step(policy, 0, 1) is None
    assert step(policy, 1, 2) is Op.PROTECT


def test_stops_renewing_after_max_hours() -> None:
    policy = ProtectionPolicy(RULES)
    assert step(policy, 1, 0) is Op.PROTECT
    t = 0.0
    while t < 12 * HOUR - 20 * MIN:
        t += 20 * MIN
        assert step(policy, 3, t) is Op.PROTECT
    # 上限を過ぎたら、ジョブがあっても延長しない(期限切れに任せる)
    assert step(policy, 3, 12 * HOUR) is None
    assert step(policy, 3, 13 * HOUR) is None
    # ジョブが 0 になったら外し、次のジョブからまた数え直す
    assert step(policy, 0, 13 * HOUR + 1) is Op.UNPROTECT
    assert step(policy, 1, 14 * HOUR) is Op.PROTECT
    assert step(policy, 1, 14 * HOUR + 20 * MIN) is Op.PROTECT


def test_zero_max_hours_means_no_limit() -> None:
    policy = ProtectionPolicy(ProtectionRules(max_hours=0))
    assert step(policy, 1, 0) is Op.PROTECT
    assert step(policy, 1, 100 * HOUR) is Op.PROTECT


@pytest.mark.parametrize(
    ("expires_min", "renew_min"),
    [(0, 0.5), (2881, 20), (60, 60), (60, 0)],
)
def test_rules_reject_invalid_values(expires_min: int, renew_min: float) -> None:
    with pytest.raises(ValueError):
        ProtectionRules(expires_min=expires_min, renew_min=renew_min)


def test_rules_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASK_PROTECTION_EXPIRES_MIN", "30")
    monkeypatch.setenv("TASK_PROTECTION_RENEW_MIN", "10")
    monkeypatch.setenv("TASK_PROTECTION_MAX_HOURS", "0")
    rules = ProtectionRules.from_env()
    assert (rules.expires_min, rules.renew_min, rules.max_hours) == (30, 10, 0)


def test_is_success() -> None:
    # 応答の例は公式のドキュメント(task-scale-in-protection-endpoint)から
    assert is_success(
        '{"protection":{"ExpirationDate":"2023-12-20T21:57:44.837Z",'
        '"ProtectionEnabled":true,"TaskArn":"arn:aws:ecs:us-west-2:111122223333:task/1"}}'
    )
    assert not is_success('{"failure":{"Arn":"arn","Detail":null,"Reason":"TASK_NOT_VALID"}}')
    assert not is_success(
        '{"requestID":"1","error":{"Arn":"arn","Code":"AccessDeniedException","Message":"x"}}'
    )
    assert not is_success("not json")
