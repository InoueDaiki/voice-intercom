"""Agent の起動。明示ディスパッチ(agent_name)で、ルームごとに1つのジョブを受ける。"""

import logging

import openai
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli

from . import scale_to_zero, task_protection
from .agent import IntercomAgent
from .config import Settings, agent_name
from .text_translation import TextTranslator

logger = logging.getLogger(__name__)

server = AgentServer()
# ECS の上では、ジョブを持っている間だけタスクのスケールイン保護を付ける
task_protection.install(server)
# Agent のいないルームを割り当て直し、dev では使われなくなったら台数を 0 にする
scale_to_zero.install(server, agent_name())


@server.rtc_session(agent_name=agent_name())
async def entrypoint(ctx: JobContext) -> None:
    settings = Settings.from_env()
    translator = TextTranslator(
        openai.AsyncOpenAI(api_key=settings.openai_api_key), settings.text_translate_model
    )
    # 先にイベントを登録してから接続する(入室済みの話者のトラックも取りこぼさない)
    agent = IntercomAgent(ctx.room, settings, translator)
    ctx.add_shutdown_callback(agent.aclose)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    agent.connected()
    logger.info("ルームに入った: %s", ctx.room.name)


def main() -> None:
    cli.run_app(server)
