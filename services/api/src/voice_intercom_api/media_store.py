"""画像・動画を置く S3 の操作(署名付き URL の発行、マルチパート、置かれたかの確認、消すこと)。

バケット名は環境変数 MEDIA_BUCKET で受け取る。ローカルでは scripts/with-local-aws.sh が
接続先(AWS_ENDPOINT_URL_S3)を SeaweedFS に向ける。

キーはルームと media_id から決める。
- 本体: rooms/<room_id>/<media_id>/original
- サムネイル: rooms/<room_id>/<media_id>/thumbnail
ルームを消したときは、rooms/<room_id>/ の下をすべて消す(purge_prefix。room_cleanup.py)。
本体を rooms/<room_id>/<media_id> にすると、サムネイルのキーがその「下」になる。
SeaweedFS(ファイラーがディレクトリを持つ)では、同じ名前のファイルとディレクトリを両方は
作れないので、どちらも1段下げる。

1回の PUT(本体が 16MB 未満、サムネイル)の署名付き URL は、配信するキーではなく仮置きのキー
(rooms/.staging/<room_id>/<media_id>/original、thumbnail)に向ける。complete で大きさを
確かめてから、配信するキーへコピーする(media.py)。署名付き URL は期限(1時間)まで何度でも
PUT できるので、配信するキーに直接向けると、complete の後や削除の後に PUT し直して、
大きさの確かめを通らない中身に置き換えたり、消したものを戻したりできてしまうため。
- complete の後に仮置きのキーへ PUT し直しても、配信するキーは変わらない。
- 仮置きのキーは、CloudFront からは読めない(バケットポリシーで拒む。infra/modules/media)。
- complete されなかった仮置きと、complete の後に置き直されたものは、ライフサイクルルールが1日で
  消す(infra/modules/media)。ルールは前置きでしか絞れないので、仮置きだけを
  rooms/.staging/ の下に集める。「.」はルームの ID に使えないので、ルームの前置きと混ざらない。
  rooms/ の下なので、Lambda の削除の権限(rooms/*)はそのまま使える。
- 本体の大きさは署名で縛る(presign_put、presign_upload_part の Content-Length)。クライアントは
  uploads に渡した大きさのとおりに PUT する。サムネイルは uploads の時点で大きさが分からないので
  縛れず、complete で確かめる。
- マルチパートの本体は、配信するキーのまま。完了した後の UploadPart は失敗する(NoSuchUpload)。
"""

import time
from dataclasses import dataclass
from datetime import timedelta
from functools import cache
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from voice_intercom_api.config import get_timeline_settings

# 署名付き URL の期限。期限は PUT を始めるときに確かめられるので、大きい動画でも途中で切れない
UPLOAD_URL_TTL = timedelta(hours=1)


def media_key(room_id: str, media_id: str) -> str:
    return f"rooms/{room_id}/{media_id}/original"


def thumbnail_key(room_id: str, media_id: str) -> str:
    return f"rooms/{room_id}/{media_id}/thumbnail"


# 仮置きの前置き。infra/modules/media のライフサイクルルールとバケットポリシーと揃える
STAGING_PREFIX = "rooms/.staging/"


def staging_media_key(room_id: str, media_id: str) -> str:
    """1回の PUT の本体の仮置きのキー(配信しない)。"""
    return f"{STAGING_PREFIX}{room_id}/{media_id}/original"


def staging_thumbnail_key(room_id: str, media_id: str) -> str:
    """サムネイルの仮置きのキー(配信しない)。"""
    return f"{STAGING_PREFIX}{room_id}/{media_id}/thumbnail"


def media_prefix(room_id: str, media_id: str) -> str:
    """本体とサムネイルを含む、media_id ごとのキーの前置き(CloudFront の無効化に使う)。"""
    return f"rooms/{room_id}/{media_id}/"


def room_prefix(room_id: str) -> str:
    """ルームのすべてのオブジェクトのキーの前置き(ルームを消したときに使う)。"""
    return f"rooms/{room_id}/"


def staging_room_prefix(room_id: str) -> str:
    """ルームの仮置きのキーの前置き(ルームを消したときに使う)。"""
    return f"{STAGING_PREFIX}{room_id}/"


def public_url(key: str) -> str:
    """表示・再生の URL(本番は CloudFront、ローカルは SeaweedFS のバケット)。"""
    return f"{get_timeline_settings().media_base_url}/{key}"


@cache
def _s3() -> Any:
    # - 署名は SigV4 にする(Content-Type を署名に含め、違う Content-Type の PUT を 403 にする)
    # - virtual を明示すると、リージョンのエンドポイント(<bucket>.s3.<region>.amazonaws.com)で
    #   署名する。グローバルのエンドポイントは、作ったばかりのバケットでリダイレクトされ、
    #   署名付きの PUT が失敗する。
    #   接続先が IP アドレス(ローカルの SeaweedFS)のときは、botocore がパス形式に切り替える
    return boto3.client(
        "s3", config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
    )


def presign_put(
    key: str,
    content_type: str,
    content_disposition: str | None = None,
    *,
    content_length: int | None = None,
) -> str:
    """PUT の署名付き URL。

    Content-Type を署名に含める(X-Amz-SignedHeaders に content-type が入る)。
    content_disposition を渡せば、それも署名に含め、オブジェクトに持たせる(配信の応答に付く)。
    content_length を渡せば、それも署名に含める。違う大きさの PUT は S3 が 403 にする。
    """
    params: dict[str, Any] = {
        "Bucket": get_timeline_settings().media_bucket,
        "Key": key,
        "ContentType": content_type,
    }
    if content_disposition is not None:
        params["ContentDisposition"] = content_disposition
    if content_length is not None:
        params["ContentLength"] = content_length
    return _s3().generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=int(UPLOAD_URL_TTL.total_seconds()),
    )


def create_multipart(key: str, content_type: str, content_disposition: str | None = None) -> str:
    """マルチパートアップロードを始め、UploadId を返す。

    Content-Type と Content-Disposition はここで決まる(パートの PUT には要らない)。
    """
    extra = {} if content_disposition is None else {"ContentDisposition": content_disposition}
    res = _s3().create_multipart_upload(
        Bucket=get_timeline_settings().media_bucket, Key=key, ContentType=content_type, **extra
    )
    return res["UploadId"]


def presign_upload_part(key: str, upload_id: str, part_number: int, content_length: int) -> str:
    """パートの PUT(UploadPart)の署名付き URL。

    署名に入るヘッダーは host と content-length。違う大きさの PUT は S3 が 403 にする。
    """
    return _s3().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": get_timeline_settings().media_bucket,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
            "ContentLength": content_length,
        },
        ExpiresIn=int(UPLOAD_URL_TTL.total_seconds()),
    )


class MultipartGoneError(Exception):
    """マルチパートアップロードが無い(完了した、消した、期限で消えた)。"""


class InvalidPartsError(Exception):
    """渡したパートでは完了できない(ETag が合わない、最後でないパートが 5MB 未満など)。"""


def complete_multipart(key: str, upload_id: str, parts: list[tuple[int, str]]) -> None:
    """パートの番号と ETag の並び(番号の順)で、マルチパートアップロードを完了する。"""
    try:
        _s3().complete_multipart_upload(
            Bucket=get_timeline_settings().media_bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={
                "Parts": [{"PartNumber": number, "ETag": etag} for number, etag in parts]
            },
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code == "NoSuchUpload":
            raise MultipartGoneError(upload_id) from e
        if code in ("InvalidPart", "InvalidPartOrder", "EntityTooSmall"):
            raise InvalidPartsError(code) from e
        raise


def abort_multipart(key: str, upload_id: str) -> None:
    """マルチパートアップロードを取りやめ、上げたパートを消す。無ければ何もしない。"""
    try:
        _s3().abort_multipart_upload(
            Bucket=get_timeline_settings().media_bucket, Key=key, UploadId=upload_id
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "NoSuchUpload":
            raise


@dataclass(frozen=True)
class ObjectInfo:
    content_type: str
    size_bytes: int
    etag: str


def head(key: str) -> ObjectInfo | None:
    """オブジェクトの Content-Type と大きさ。なければ None。

    IAM に s3:ListBucket がないと、ないオブジェクトの HeadObject は 404 ではなく 403 になるので、
    Terraform で ListBucket も許可してある(infra/envs/<env>/main.tf)。
    """
    try:
        res = _s3().head_object(Bucket=get_timeline_settings().media_bucket, Key=key)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return ObjectInfo(
        content_type=res.get("ContentType", ""),
        size_bytes=res["ContentLength"],
        etag=res.get("ETag", ""),
    )


class ChangedError(Exception):
    """コピーの元が、確かめた後に置き直された(ETag が違う)。"""


def copy(source: str, dest: str, *, etag: str) -> bool:
    """同じバケットの中でオブジェクトをコピーする(5GB まで)。元が無ければ False。

    etag は HeadObject で確かめたときの ETag。確かめた後に元が置き直されていたら、コピーせずに
    ChangedError にする(CopySourceIfMatch)。確かめていない中身を配信するキーに置かないため。
    MetadataDirective は既定の COPY なので、Content-Type と Content-Disposition もそのまま移る。
    IAM では、元に s3:GetObject、先に s3:PutObject が要る。
    """
    bucket = get_timeline_settings().media_bucket
    try:
        _s3().copy_object(
            Bucket=bucket,
            Key=dest,
            CopySource={"Bucket": bucket, "Key": source},
            CopySourceIfMatch=etag,
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        if code in ("412", "PreconditionFailed"):
            raise ChangedError(source) from e
        raise
    return True


def delete(keys: list[str]) -> None:
    """オブジェクトを消す。無いものを消しても失敗にならない(S3 の DeleteObject と同じ)。"""
    bucket = get_timeline_settings().media_bucket
    for key in keys:
        _s3().delete_object(Bucket=bucket, Key=key)


class PurgeError(Exception):
    """DeleteObjects で消せないオブジェクトがあった。"""


def purge_prefix(prefix: str, *, deadline: float) -> tuple[bool, int]:
    """prefix の下のオブジェクトをすべて消し、途中のマルチパートアップロードも取りやめる。

    (消しきれたか, 消したオブジェクトの数)を返す。deadline(time.monotonic の値)を過ぎたら、
    残りを消さずに False を返す。何度呼んでもよい。
    """
    s3 = _s3()
    bucket = get_timeline_settings().media_bucket
    # 先に取りやめる(この後で完了して、オブジェクトが置き直されないように)
    uploads: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
    while True:
        if time.monotonic() > deadline:
            return False, 0
        res = s3.list_multipart_uploads(**uploads)
        for upload in res.get("Uploads", []):
            abort_multipart(upload["Key"], upload["UploadId"])
        if not res.get("IsTruncated"):
            break
        uploads["KeyMarker"] = res.get("NextKeyMarker", "")
        uploads["UploadIdMarker"] = res.get("NextUploadIdMarker", "")
    deleted = 0
    while True:
        if time.monotonic() > deadline:
            return False, deleted
        # 消した分は一覧から無くなるので、毎回先頭から読む(1回 1000 件まで)
        res = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
        objects = [{"Key": obj["Key"]} for obj in res.get("Contents", [])]
        if not objects:
            return True, deleted
        out = s3.delete_objects(Bucket=bucket, Delete={"Objects": objects, "Quiet": True})
        if errors := out.get("Errors"):
            # 同じものを読み直し続けないよう、ここでやめる
            raise PurgeError(f"{len(errors)} 件を消せなかった: {errors[0]}")
        deleted += len(objects)


@cache
def _cloudfront() -> Any:
    # Lambda の timeout(15秒)に収まるよう、待ちを短くする
    return boto3.client(
        "cloudfront",
        config=Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 2}),
    )


def invalidate(paths: list[str], *, caller_reference: str) -> bool:
    """CloudFront のキャッシュを無効にする。ディストリビューションが無い(ローカル)なら False。

    paths は / で始まるパス(末尾の * で前置きの一致)。同じ caller_reference の2回目は、
    CloudFront が新しい無効化を作らずに前のものを返す。
    """
    distribution_id = get_timeline_settings().media_distribution_id
    if not distribution_id:
        return False
    _cloudfront().create_invalidation(
        DistributionId=distribution_id,
        InvalidationBatch={
            "Paths": {"Quantity": len(paths), "Items": paths},
            "CallerReference": caller_reference,
        },
    )
    return True
