"""画像・動画を置く S3 の操作(署名付き URL の発行、マルチパート、置かれたかの確認、消すこと)。

バケット名は環境変数 MEDIA_BUCKET で受け取る。ローカルでは scripts/with-local-aws.sh が
接続先(AWS_ENDPOINT_URL_S3)を SeaweedFS に向ける。

キーはルームと media_id から決める。
- 本体: rooms/<room_id>/<media_id>/original
- サムネイル: rooms/<room_id>/<media_id>/thumbnail
本体を rooms/<room_id>/<media_id> にすると、サムネイルのキーがその「下」になる。
SeaweedFS(ファイラーがディレクトリを持つ)では、同じ名前のファイルとディレクトリを両方は
作れないので、どちらも1段下げる。
"""

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


def media_prefix(room_id: str, media_id: str) -> str:
    """本体とサムネイルを含む、media_id ごとのキーの前置き(CloudFront の無効化に使う)。"""
    return f"rooms/{room_id}/{media_id}/"


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


def presign_put(key: str, content_type: str, content_disposition: str | None = None) -> str:
    """PUT の署名付き URL。

    Content-Type を署名に含める(X-Amz-SignedHeaders に content-type が入る)。
    content_disposition を渡せば、それも署名に含め、オブジェクトに持たせる(配信の応答に付く)。
    """
    params = {
        "Bucket": get_timeline_settings().media_bucket,
        "Key": key,
        "ContentType": content_type,
    }
    if content_disposition is not None:
        params["ContentDisposition"] = content_disposition
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


def presign_upload_part(key: str, upload_id: str, part_number: int) -> str:
    """パートの PUT(UploadPart)の署名付き URL。署名に入るヘッダーは host だけ。"""
    return _s3().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": get_timeline_settings().media_bucket,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
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
    return ObjectInfo(content_type=res.get("ContentType", ""), size_bytes=res["ContentLength"])


def delete(keys: list[str]) -> None:
    """オブジェクトを消す。無いものを消しても失敗にならない(S3 の DeleteObject と同じ)。"""
    bucket = get_timeline_settings().media_bucket
    for key in keys:
        _s3().delete_object(Bucket=bucket, Key=key)


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
