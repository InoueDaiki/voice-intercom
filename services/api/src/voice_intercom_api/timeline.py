"""ルームの履歴(timeline)の API。

発話(字幕の区切りごと)とテキスト入力は、Agent が API 経由で保存する。画像・動画は media.py の
complete が保存する。アプリと管理コンソールは、ここから履歴を新しい順に読む。
"""

from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.openapi.params import Body, Path, Query

from voice_intercom_api import timeline_store
from voice_intercom_api.auth import AgentPrincipal, CurrentUser
from voice_intercom_api.routing import (
    AUTH,
    ROOM_NOT_FOUND,
    RoomIdPath,
    existing_room,
    responses,
    visible_room,
)
from voice_intercom_api.timeline_models import (
    SOURCE_ID_PATTERN,
    PutTimelineEventRequest,
    TimelineEvent,
    TimelinePage,
)

router = Router()

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


@router.get(
    "/rooms/<room_id>/timeline",
    summary="ルームの履歴を新しい順に取る(管理者かメンバー)",
    operation_id="listTimeline",
    tags=["timeline"],
    security=AUTH,
    responses=responses(TimelinePage, errors=ROOM_NOT_FOUND),
)
def list_timeline(
    room_id: RoomIdPath,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT, description="件数")] = DEFAULT_LIMIT,
    before: Annotated[
        str | None,
        Query(
            min_length=1,
            max_length=256,
            description="この event_id より古いものを取る(前の応答の next_before)",
        ),
    ] = None,
) -> TimelinePage:
    visible_room(room_id, user)
    items, next_before = timeline_store.list_events(room_id, limit=limit, before=before)
    return TimelinePage(items=items, next_before=next_before)


@router.put(
    "/rooms/<room_id>/timeline/<source_id>",
    summary="発話かテキスト入力を履歴に保存する(Agent)。同じ内容なら何度呼んでも同じ結果になる",
    description="event_id は `<occurred_at>#<source_id>` で作る。"
    "同じ event_id があれば置き換える。",
    operation_id="putTimelineEvent",
    tags=["timeline"],
    security=AUTH,
    responses=responses(TimelineEvent, errors=ROOM_NOT_FOUND),
)
def put_timeline_event(
    room_id: RoomIdPath,
    source_id: Annotated[
        str,
        Path(
            pattern=SOURCE_ID_PATTERN,
            description="utterance では字幕の segment_id、text ではメッセージの ID",
        ),
    ],
    body: Annotated[PutTimelineEventRequest, Body()],
    _agent: AgentPrincipal,
) -> TimelineEvent:
    existing_room(room_id)
    return timeline_store.put_event(room_id, source_id, body)
