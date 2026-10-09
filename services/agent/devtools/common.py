"""確認用ツールの共通部分(トークンの発行と WAV の読み込み)。"""

import argparse
import os
import wave
from pathlib import Path

import numpy as np
from livekit import api, rtc
from livekit.protocol.agent_dispatch import RoomAgentDispatch
from livekit.protocol.room import RoomConfiguration
from voice_intercom_agent.config import agent_name
from voice_intercom_agent.languages import LANGUAGE_ATTRIBUTE


def add_connection_args(p: argparse.ArgumentParser, identity: str) -> None:
    p.add_argument("--url", default=os.environ.get("LIVEKIT_URL", "ws://localhost:7880"))
    p.add_argument("--room", default="test")
    p.add_argument("--identity", default=identity)
    p.add_argument("--language", required=True, help="参加者の属性 language(例: ja)")
    p.add_argument(
        "--dispatch",
        action="store_true",
        help="トークンに Agent のディスパッチを入れる。ルームを作る最初の参加者で使う",
    )


def make_token(args: argparse.Namespace) -> str:
    token = (
        api.AccessToken(
            os.environ.get("LIVEKIT_API_KEY", "devkey"),
            os.environ.get("LIVEKIT_API_SECRET", "secret"),
        )
        .with_identity(args.identity)
        .with_attributes({LANGUAGE_ATTRIBUTE: args.language})
        .with_grants(api.VideoGrants(room_join=True, room=args.room))
    )
    if args.dispatch:
        token = token.with_room_config(
            RoomConfiguration(agents=[RoomAgentDispatch(agent_name=agent_name())])
        )
    return token.to_jwt()


def load_pcm(path: Path, rate: int) -> np.ndarray:
    """16bit の WAV を読み、指定のサンプルレートのモノラルにする。"""
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit(f"{path}: 16bit の WAV にしてください")
        src_rate = w.getframerate()
        channels = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1).astype(np.int16)
    if src_rate == rate:
        return data
    resampler = rtc.AudioResampler(src_rate, rate)
    frames = resampler.push(bytearray(data.tobytes()))
    frames += resampler.flush()
    return np.concatenate([np.frombuffer(f.data, dtype=np.int16) for f in frames])
