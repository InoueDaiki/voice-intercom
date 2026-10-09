"""whisper の書き起こしをテキストで翻訳し、gpt-realtime-translate と比べるための結果を作る。

eval_batch.py の出力(whisper を有効にした回)を読み、書き起こしを言語モデルで翻訳する。
出力は eval_batch.py と同じ形(results.jsonl)なので、judge.py でそのまま採点できる。

使い方は poc/README.md を参照する。
"""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

import openai
import sacrebleu
from judge import LANG_NAMES

DEFAULT_MODEL = "gpt-6-luna"

INSTRUCTIONS = """\
ボイスインカム(業務用の無線のような音声連絡)の発話を書き起こしたテキストを翻訳します。
- 訳文だけを出力します。説明や引用符は付けません。
- 意味を正確に保ち、話し言葉として自然な訳にします。
- 数字、固有名詞、単位は落とさずに訳します。
- 書き起こしには聞き取りの誤りが含まれることがあります。明らかな誤りは文脈から補いますが、
  内容を付け足しません。
"""


async def translate_one(
    client: openai.AsyncOpenAI,
    row: dict,
    target: str,
    args: argparse.Namespace,
    sem: asyncio.Semaphore,
) -> dict:
    text = row["whisper"].strip()
    if not text:
        return {**row, "hypothesis": "", "ttft_s": None, "total_s": None}
    async with sem:
        t0 = time.monotonic()
        ttft = None
        parts: list[str] = []
        stream = await client.responses.create(
            model=args.model,
            instructions=INSTRUCTIONS + f"\n翻訳先: {LANG_NAMES.get(target, target)}",
            input=text,
            reasoning={"effort": args.effort},
            stream=True,
        )
        async for ev in stream:
            if ev.type == "response.output_text.delta":
                if ttft is None:
                    ttft = time.monotonic() - t0
                parts.append(ev.delta)
        total = time.monotonic() - t0
    hyp = "".join(parts).strip()
    ref = row["reference"]
    return {
        **row,
        "hypothesis": hyp,
        "chrf": round(sacrebleu.sentence_chrf(hyp, [ref]).score, 1) if ref else None,
        "ttft_s": round(ttft, 2) if ttft is not None else None,
        "total_s": round(total, 2),
    }


def stats(values: list[float | None]) -> str:
    v = sorted(x for x in values if x is not None)
    if not v:
        return "-"
    p90 = v[min(len(v) - 1, round(len(v) * 0.9) - 1)]
    return f"中央値 {statistics.median(v):.2f} / p90 {p90:.2f} / 最大 {v[-1]:.2f}"


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("batch_dir", type=Path, help="eval_batch.py の出力(whisper を有効にした回)")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--effort", default="none", help="reasoning effort")
    p.add_argument("--jobs", type=int, default=8)
    args = p.parse_args()

    src = json.loads(next(args.batch_dir.glob("runs/*/*/summary.json")).read_text())["args"]
    source_lang, target = src["source_lang"], src["to"]
    rows = [
        json.loads(line) for line in (args.batch_dir / "results.jsonl").read_text().splitlines()
    ]
    if not any(r.get("whisper") for r in rows):
        raise SystemExit(
            "whisper の書き起こしがありません。whisper を有効にした回を指定してください"
        )

    client = openai.AsyncOpenAI()
    sem = asyncio.Semaphore(args.jobs)
    results = await asyncio.gather(*(translate_one(client, r, target, args, sem) for r in rows))

    out_dir = args.batch_dir.parent / f"{args.batch_dir.name}-text-{args.model}"
    out_dir.mkdir(exist_ok=True)
    with (out_dir / "results.jsonl").open("w") as f:
        for r in results:
            row = {**r, "source_lang": source_lang, "target_lang": target}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    scored = [r for r in results if r["reference"]]
    corpus = sacrebleu.corpus_chrf(
        [r["hypothesis"] for r in scored], [[r["reference"] for r in scored]]
    )
    report = "\n".join(
        [
            f"# テキスト翻訳: {args.batch_dir.name}",
            "",
            f"- モデル: {args.model}(reasoning effort: {args.effort})",
            f"- 件数: {len(results)}",
            f"- 最初の文字まで(秒): {stats([r['ttft_s'] for r in results])}",
            f"- 翻訳の完了まで(秒): {stats([r['total_s'] for r in results])}",
            f"- 訳の chrF(全体): {corpus.score:.1f}",
        ]
    )
    (out_dir / "report.md").write_text(report + "\n")
    print(report + f"\n\n保存先: {out_dir}")


if __name__ == "__main__":
    asyncio.run(main())
