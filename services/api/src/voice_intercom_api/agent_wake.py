"""使っていない間に 0 台にした Agent を起こす(dev の scale to zero)。

設計メモの「Agent の scale to zero」。

LiveKit のトークンを出すとき(だれかが入室するとき)に、Agent の ECS のサービスの台数
(desiredCount)が 0 なら 1 にする。止めるのは Agent 自身(services/agent の scale_to_zero.py)。

- AGENT_ECS_CLUSTER と AGENT_ECS_SERVICE がそろっているときだけ動く(Terraform が dev で渡す)。
  ローカルと prod では何もしない。
- 起動には 1〜2 分かかる。その間に作られたルームは、起動した Agent が割り当て直す
  (LiveKit は、Agent がいないときの割り当てを後から渡さないため)。
- 失敗してもトークンは出す(ログに残す)。ECS の呼び出しは短く打ち切る(Lambda の timeout に収める)。
"""

import logging
import os
from functools import cache
from typing import Any

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)


@cache
def _ecs() -> Any:
    return boto3.client(
        "ecs",
        config=Config(connect_timeout=1, read_timeout=2, retries={"max_attempts": 1}),
    )


def wake() -> bool:
    """台数が 0 なら 1 にする。起こしたら True。"""
    cluster = os.environ.get("AGENT_ECS_CLUSTER", "")
    service = os.environ.get("AGENT_ECS_SERVICE", "")
    if not (cluster and service):
        return False
    try:
        res = _ecs().describe_services(cluster=cluster, services=[service])
        services = res.get("services", [])
        if not services or services[0].get("desiredCount", 0) > 0:
            return False
        # 同時に2人が入っても、どちらも 1 にするだけ(2 台にはならない)
        _ecs().update_service(cluster=cluster, service=service, desiredCount=1)
    except Exception:
        logger.exception("Agent を起こせなかった: %s/%s", cluster, service)
        return False
    logger.info("Agent の台数を 0 から 1 にした: %s/%s", cluster, service)
    return True
