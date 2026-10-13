"""画像・動画のアップロードの API。

1. アプリ(か管理コンソール)が uploads で署名付き URL をもらい、S3 に本体(とサムネイル)を
   直接 PUT する。
2. complete を呼ぶと、置かれたことを確かめてから、履歴(kind media)に保存する。
3. 保存した後に、今ルームにいる人へデータチャネル(topic "media")で知らせ、いない人には
   push 通知を送る(media_broadcast.py)。2回目からは、知らせ直すだけで push 通知は送らない。
4. 受け取った側は、履歴の media.url(CloudFront)で表示・再生する。

complete を呼べるのはアップロードした本人だけ。uploads のときに、アップロードした人を DynamoDB の
仮の行に書いておき、complete で照らし合わせる(timeline_store.py)。
- S3 のメタデータ(x-amz-meta-*)に入れる方法は、クライアントにもそのヘッダーを送らせる必要があり、
  付け忘れると 403 になるうえ、アプリと管理コンソールの両方の作りが増える。
- キーに sub を入れる方法は、公開する URL に sub が出るうえ、他人が complete したときに
  「本人ではない」(403)と「まだ置かれていない」(409)を見分けられない。
仮の行には Content-Type や大きさも持たせるので、complete でクライアントに送り直させずに済む。

上限は 100MB で、単一の PUT だけにする。マルチパートは後回し(README)。
"""

import uuid
from dataclasses import replace
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import (
    ForbiddenError,
    NotFoundError,
    ServiceError,
)
from aws_lambda_powertools.event_handler.openapi.params import Body, Path

from voice_intercom_api import media_broadcast, media_store, store, timeline_store
from voice_intercom_api.auth import CurrentUser
from voice_intercom_api.models import Room
from voice_intercom_api.routing import AUTH, ROOM_NOT_FOUND, RoomIdPath, responses, visible_room
from voice_intercom_api.timeline_models import (
    MAX_MEDIA_BYTES,
    MEDIA_ID_PATTERN,
    THUMBNAIL_CONTENT_TYPE,
    CompleteMediaUploadRequest,
    CreateMediaUploadRequest,
    MediaUpload,
    TimelineEvent,
    format_timestamp,
)

router = Router()

# サムネイルの上限。署名付き URL では大きさを縛れないので、complete で確かめる
MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024


@router.post(
    "/rooms/<room_id>/media/uploads",
    summary="画像・動画をアップロードする署名付き URL を発行する(管理者かメンバー)",
    description="PUT するときは Content-Type ヘッダーを content_type(サムネイルは image/jpeg)と"
    "同じにする。違うと S3 が 403 を返す。アップロードしたら complete を呼ぶ。",
    operation_id="createMediaUpload",
    tags=["media"],
    security=AUTH,
    responses=responses(MediaUpload, errors=ROOM_NOT_FOUND),
)
def create_media_upload(
    room_id: RoomIdPath, body: Annotated[CreateMediaUploadRequest, Body()], user: CurrentUser
) -> MediaUpload:
    visible_room(room_id, user)
    media_id = uuid.uuid4().hex
    expires_at = datetime.now(UTC) + media_store.UPLOAD_URL_TTL
    timeline_store.create_pending_upload(
        room_id,
        media_id,
        uploader_id=user.sub,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        has_thumbnail=body.has_thumbnail,
    )
    return MediaUpload(
        media_id=media_id,
        upload_url=media_store.presign_put(
            media_store.media_key(room_id, media_id), body.content_type
        ),
        thumbnail_upload_url=media_store.presign_put(
            media_store.thumbnail_key(room_id, media_id), THUMBNAIL_CONTENT_TYPE
        )
        if body.has_thumbnail
        else None,
        expires_at=format_timestamp(expires_at),
    )


def _conflict(message: str) -> ServiceError:
    return ServiceError(HTTPStatus.CONFLICT, message)


@router.post(
    "/rooms/<room_id>/media/<media_id>/complete",
    summary="アップロードした画像・動画を履歴に保存する(アップロードした本人)",
    description="本体(とサムネイル)が置かれていなければ 409。"
    "2回目からは、最初に保存した履歴を返す。"
    "保存した後に、今ルームにいる人へデータチャネル(topic media、MediaMessage)で配信し、"
    "最初の complete のときだけ、ルームにいないメンバーへ push 通知を送る。"
    "配信や通知に失敗しても、履歴を 200 で返す。2回目でも配信はやり直す。",
    operation_id="completeMediaUpload",
    tags=["media"],
    security=AUTH,
    responses=responses(
        TimelineEvent,
        errors={
            404: "ルームか、アップロード(media_id)がない",
            409: "本体かサムネイルがまだ置かれていない、または上限より大きい",
        },
    ),
)
def complete_media_upload(
    room_id: RoomIdPath,
    media_id: Annotated[
        str, Path(pattern=MEDIA_ID_PATTERN, description="uploads が返した media_id")
    ],
    body: Annotated[CompleteMediaUploadRequest, Body()],
    user: CurrentUser,
) -> TimelineEvent:
    room = visible_room(room_id, user)
    pending = timeline_store.get_pending_upload(room_id, media_id)
    if pending is None:
        raise NotFoundError("アップロードがない")
    if pending.uploader_id != user.sub:
        raise ForbiddenError("アップロードした本人ではない")
    if pending.completed_event_id is not None:
        return _announce_again(room, _completed_event(room_id, pending.completed_event_id))

    original = media_store.head(media_store.media_key(room_id, media_id))
    if original is None:
        raise _conflict("本体がまだ置かれていない")
    if original.size_bytes > MAX_MEDIA_BYTES:
        raise _conflict("本体が上限(100MB)より大きい")
    if pending.has_thumbnail:
        thumbnail = media_store.head(media_store.thumbnail_key(room_id, media_id))
        if thumbnail is None:
            raise _conflict("サムネイルがまだ置かれていない")
        if thumbnail.size_bytes > MAX_THUMBNAIL_BYTES:
            raise _conflict("サムネイルが上限(10MB)より大きい")

    # 宣言された大きさではなく、実際に置かれた大きさを履歴に書く
    pending = replace(pending, size_bytes=original.size_bytes)
    # 画像に添えた文の言語は、送った人のプロフィールの言語とみなす(翻訳はしない)
    profile = store.get_user(user.sub)
    try:
        event = timeline_store.complete_upload(
            pending,
            sender_id=user.sub,
            occurred_at=format_timestamp(datetime.now(UTC)),
            language=None if profile is None else profile.language,
            text=body.text,
        )
    except timeline_store.AlreadyCompletedError as e:
        # 同時に呼ばれた別の complete が先に保存した。push 通知はそちらが送る
        return _announce_again(room, _completed_event(room_id, e.event_id))
    media_broadcast.announce(room, event, profile, first=True)
    return event


def _announce_again(room: Room, event: TimelineEvent) -> TimelineEvent:
    """2回目からの complete。配信だけをやり直す(push 通知は送らない)。"""
    media_broadcast.announce(room, event, None, first=False)
    return event


def _completed_event(room_id: str, event_id: str) -> TimelineEvent:
    event = timeline_store.get_event(room_id, event_id)
    if event is None:
        # 仮の行には completed_event_id があるのに、履歴がない(手で消したなど)
        raise NotFoundError("保存した履歴がない")
    return event
