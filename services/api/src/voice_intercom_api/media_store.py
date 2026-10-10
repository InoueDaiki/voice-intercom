"""画像・動画を置く S3 の操作(署名付き URL の発行と、置かれたかの確認)。

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


def presign_put(key: str, content_type: str) -> str:
    """PUT の署名付き URL。

    Content-Type を署名に含める(X-Amz-SignedHeaders に content-type が入る)。
    """
    return _s3().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": get_timeline_settings().media_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=int(UPLOAD_URL_TTL.total_seconds()),
    )


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
