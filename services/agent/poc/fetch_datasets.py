"""評価用のデータセット(FLEURS、CoVoST 2)から文を選び、24kHz の WAV と一覧(manifest)を作る。

- FLEURS: google/fleurs の validation 分割(CC BY 4.0)。文の ID が言語をまたいで共通なので、
  ほかの言語の同じ ID の文を正解の訳として使う。
- CoVoST 2: fixie-ai/covost2(Common Voice の音声に訳をつけた CoVoST 2 のミラー)の test 分割。
  訳は CC BY-NC 4.0。

使い方は poc/README.md を参照する。
"""

import argparse
import csv
import io
import json
import random
import sys
import urllib.request
import wave
from pathlib import Path

import av
import numpy as np
import pyarrow.parquet as pq

POC_DIR = Path(__file__).parent
CACHE_DIR = POC_DIR / "cache"
AUDIO_DIR = POC_DIR / "audio"
SAMPLE_RATE = 24000

HF = "https://huggingface.co/datasets"
FLEURS_REPO = "google/fleurs"
COVOST_REPO = "fixie-ai/covost2"

# 翻訳先に選べる13言語(API の言語コード → FLEURS の言語コード)
FLEURS_LANGS = {
    "en": "en_us",
    "ja": "ja_jp",
    "es": "es_419",
    "pt": "pt_br",
    "fr": "fr_fr",
    "ru": "ru_ru",
    "zh": "cmn_hans_cn",
    "de": "de_de",
    "ko": "ko_kr",
    "hi": "hi_in",
    "id": "id_id",
    "vi": "vi_vn",
    "it": "it_it",
}


def download(repo: str, path: str) -> Path:
    """Hugging Face からファイルを取得してキャッシュする。取得済みなら使い回す。"""
    dest = CACHE_DIR / repo / path
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{HF}/{repo}/resolve/main/{path}"
    print(f"取得: {url}", file=sys.stderr)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as res, tmp.open("wb") as f:
        while chunk := res.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    return dest


def decode_to_pcm24k(data: bytes) -> np.ndarray:
    """mp3 / wav などのバイト列を、24kHz・モノラル・int16 にする。"""
    resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
    out: list[np.ndarray] = []
    with av.open(io.BytesIO(data), mode="r") as container:
        for frame in container.decode(audio=0):
            for f in resampler.resample(frame):
                out.append(f.to_ndarray().reshape(-1))
    for f in resampler.resample(None):
        out.append(f.to_ndarray().reshape(-1))
    return np.concatenate(out).astype(np.int16)


def write_wav(path: Path, pcm: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())


def write_manifest(path: Path, rows: list[dict]) -> None:
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"{len(rows)} 件: {path}")


def fleurs_references(targets: list[str]) -> dict[str, dict[str, str]]:
    """言語ごとに、文の ID → 原文(句読点つき)の対応を作る。TSV は音声を含まないので小さい。"""
    refs: dict[str, dict[str, str]] = {}
    for lang in targets:
        tsv = download(FLEURS_REPO, f"data/{FLEURS_LANGS[lang]}/dev.tsv")
        by_id: dict[str, str] = {}
        with tsv.open(newline="") as f:
            for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
                # 列: ID、ファイル名、原文(句読点つき)、正規化した原文、…
                by_id.setdefault(row[0], row[2])
        refs[lang] = by_id
    return refs


def fetch_fleurs(sources: list[str], targets: list[str], n: int, seed: int) -> None:
    refs = fleurs_references(sorted(set(targets) | set(sources)))
    for src in sources:
        code = FLEURS_LANGS[src]
        parquet = download(FLEURS_REPO, f"parquet-data/{code}/validation-00000-of-00001.parquet")
        table = pq.read_table(parquet, columns=["id", "raw_transcription"])
        # 同じ文を複数の話者が読んでいるので、文の ID が重ならないように選ぶ
        first_row: dict[str, int] = {}
        for i, sid in enumerate(table.column("id").to_pylist()):
            first_row.setdefault(str(sid), i)
        ids = sorted(first_row)
        random.Random(seed).shuffle(ids)
        picked = ids[:n]
        audio = pq.read_table(parquet, columns=["audio"]).column("audio")
        texts = table.column("raw_transcription").to_pylist()
        rows = []
        for sid in picked:
            i = first_row[sid]
            wav = AUDIO_DIR / "fleurs" / src / f"{sid}.wav"
            write_wav(wav, decode_to_pcm24k(audio[i].as_py()["bytes"]))
            rows.append(
                {
                    "wav": str(wav.relative_to(POC_DIR)),
                    "dataset": "fleurs",
                    "id": sid,
                    "source_lang": src,
                    "text": texts[i],
                    "references": {t: refs[t][sid] for t in targets if t != src and sid in refs[t]},
                }
            )
        write_manifest(AUDIO_DIR / "fleurs" / src / "manifest.jsonl", rows)


def fetch_covost(pairs: list[str], n: int, seed: int) -> None:
    for pair in pairs:
        src, tgt = pair.split("_", 1)
        # test 分割の最初のファイルだけを使う(en_ja は1ファイルで約90MB)
        parquet = download(COVOST_REPO, f"{pair}/test-00000-of-00008.parquet")
        table = pq.read_table(parquet, columns=["id", "sentence", "translation"])
        idx = list(range(table.num_rows))
        random.Random(seed).shuffle(idx)
        audio = pq.read_table(parquet, columns=["audio"]).column("audio")
        rows = []
        for i in idx[:n]:
            r = table.slice(i, 1).to_pylist()[0]
            wav = AUDIO_DIR / "covost2" / pair / f"{r['id']}.wav"
            write_wav(wav, decode_to_pcm24k(audio[i].as_py()["bytes"]))
            rows.append(
                {
                    "wav": str(wav.relative_to(POC_DIR)),
                    "dataset": "covost2",
                    "id": r["id"],
                    "source_lang": src,
                    "text": r["sentence"],
                    "references": {tgt.split("-")[0]: r["translation"]},
                }
            )
        write_manifest(AUDIO_DIR / "covost2" / pair / "manifest.jsonl", rows)


def split(value: str) -> list[str]:
    return [x.strip() for x in value.split(",") if x.strip()]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = p.add_subparsers(dest="dataset", required=True)
    f = sub.add_parser("fleurs", help="FLEURS から選ぶ")
    f.add_argument("--source", default="ja,en", help="原文の言語(カンマ区切り)")
    f.add_argument(
        "--targets", default=",".join(FLEURS_LANGS), help="正解の訳を集める言語(カンマ区切り)"
    )
    f.add_argument("--n", type=int, default=20, help="言語ごとの文の数")
    c = sub.add_parser("covost", help="CoVoST 2 から選ぶ")
    c.add_argument("--pairs", default="ja_en,en_ja", help="原文_訳の組(カンマ区切り)")
    c.add_argument("--n", type=int, default=30, help="組ごとの文の数")
    for s in (f, c):
        s.add_argument("--seed", type=int, default=0)
    args = p.parse_args()

    if args.dataset == "fleurs":
        fetch_fleurs(split(args.source), split(args.targets), args.n, args.seed)
    else:
        fetch_covost(split(args.pairs), args.n, args.seed)


if __name__ == "__main__":
    main()
