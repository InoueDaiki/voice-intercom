"""ルームの履歴(timeline)の API。

発話(字幕の区切りごと)とテキスト入力は、Agent が API 経由で保存する。画像・動画は media.py の
complete が保存する。アプリと管理コンソールは、ここから履歴を新しい順に読む。

送った本人は、テキスト入力と画像・動画の行を消せる(DELETE .../timeline/event)。行は残して
墓石(deleted)にし、本文・訳・URL は返さない。後始末(ルームへの知らせ、S3 と CloudFront)は
deletion.py。event_id には # が入るので、パスではなくクエリで受け取る(生成した Dart の
クライアントはパスの値をエンコードせず、# 以降が URL のフラグメントになってしまう)。
"""

from datetime import UTC, datetime
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import ForbiddenError, NotFoundError
from aws_lambda_powertools.event_handler.openapi.params import Body, Path, Query

from voice_intercom_api import deletion, timeline_store
from voice_intercom_api.auth import AgentPrincipal, CurrentUser
from voice_intercom_api.routing import (
    AGENT_WRITE_ERRORS,
    AUTH,
    ROOM_READ_ERRORS,
    RoomIdPath,
    agent_writable_room,
    responses,
    visible_room,
    writable_room,
)
from voice_intercom_api.timeline_models import (
    DELETABLE_KINDS,
    SOURCE_ID_PATTERN,
    PutTimelineEventRequest,
    TimelineEvent,
    TimelinePage,
    format_timestamp,
)

router = Router()

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


@router.get(
    "/rooms/<room_id>/timeline",
    summary="ルームの履歴を新しい順に取る(メンバー)",
    operation_id="listTimeline",
    tags=["timeline"],
    security=AUTH,
    responses=responses(TimelinePage, errors=ROOM_READ_ERRORS),
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


EventIdQuery = Annotated[
    str,
    Query(min_length=1, max_length=256, description="履歴の行の event_id"),
]

EVENT_NOT_FOUND = {404: "ルームか、event_id の行がない"}


@router.get(
    "/rooms/<room_id>/timeline/event",
    summary="履歴の1件を取る(メンバー)。消した行は墓石(deleted)で返す",
    description="強い整合の読み取りなので、保存や削除の直後でも反映されている。"
    "アプリは、データチャネル(topic deletion)で届いた知らせを、これで確かめる。",
    operation_id="getTimelineEvent",
    tags=["timeline"],
    security=AUTH,
    responses=responses(TimelineEvent, errors=EVENT_NOT_FOUND),
)
def get_timeline_event(
    room_id: RoomIdPath, event_id: EventIdQuery, user: CurrentUser
) -> TimelineEvent:
    visible_room(room_id, user)
    event = timeline_store.get_event(room_id, event_id, consistent=True)
    if event is None:
        raise NotFoundError("行がない")
    return event


@router.delete(
    "/rooms/<room_id>/timeline/event",
    summary="送ったテキスト入力か画像・動画を消す(送った本人)",
    description="行は消さずに墓石(deleted)にし、本文・訳・URL を消す。2回目からは同じ墓石を返す"
    "(後始末はやり直す)。音声の発話と、他人の行は 403。"
    "消した後に、今ルームにいる人へデータチャネル(topic deletion、DeletionMessage)で知らせ、"
    "画像・動画なら S3 の本体とサムネイルを消して CloudFront のキャッシュを無効にする。"
    "これらが失敗しても墓石を 200 で返す。push 通知は取り消さない。",
    operation_id="deleteTimelineEvent",
    tags=["timeline"],
    security=AUTH,
    responses=responses(TimelineEvent, description="消した(墓石)", errors=EVENT_NOT_FOUND),
)
def delete_timeline_event(
    room_id: RoomIdPath, event_id: EventIdQuery, user: CurrentUser
) -> TimelineEvent:
    writable_room(room_id, user)
    event = timeline_store.get_event(room_id, event_id, consistent=True)
    if event is None:
        raise NotFoundError("行がない")
    # 他人の行は消せない(オーナーでも)
    if event.sender_id != user.sub:
        raise ForbiddenError("送った本人ではない")
    if event.kind not in DELETABLE_KINDS:
        raise ForbiddenError("音声の発話は消せない")
    if event.deleted is None:
        try:
            event = timeline_store.mark_deleted(
                room_id,
                event_id,
                sender_id=user.sub,
                deleted_at=format_timestamp(datetime.now(UTC)),
            )
        except LookupError as e:
            raise NotFoundError("行がない") from e
    deletion.after_delete(event)
    return event


@router.put(
    "/rooms/<room_id>/timeline/<source_id>",
    summary="発話かテキスト入力を履歴に保存する(Agent)。同じ内容なら何度呼んでも同じ結果になる",
    description="event_id は `<occurred_at>#<source_id>` で作る。"
    "同じ event_id があれば置き換える。ただし送った本人が消した行(墓石)は置き換えず、"
    "墓石を返す。アーカイブしたルームは 409 で、LiveKit のルームを閉じる"
    "(発行済みのトークンで作り直されたもの)。",
    operation_id="putTimelineEvent",
    tags=["timeline"],
    security=AUTH,
    responses=responses(TimelineEvent, errors=AGENT_WRITE_ERRORS),
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
    agent_writable_room(room_id)
    return timeline_store.put_event(room_id, source_id, body)
