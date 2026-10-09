"""eval_batch.py の結果(results.jsonl)の訳を、言語モデルで採点する。

chrF は言い換えで点が下がり、日本語の訳の評価に向かないため、意味が伝わるかを1〜5点で採点する。
基準は原文で、正解の訳は「正しい訳の一例」として渡す。

使い方は poc/README.md を参照する。
"""

import argparse
import asyncio
import json
import statistics
from collections import Counter
from pathlib import Path
from typing import Literal

import openai
from pydantic import BaseModel, Field

DEFAULT_MODEL = "gpt-6.1-sol"

LANG_NAMES = {
    "en": "英語",
    "ja": "日本語",
    "es": "スペイン語",
    "pt": "ポルトガル語",
    "fr": "フランス語",
    "ru": "ロシア語",
    "zh": "中国語",
    "de": "ドイツ語",
    "ko": "韓国語",
    "hi": "ヒンディー語",
    "id": "インドネシア語",
    "vi": "ベトナム語",
    "it": "イタリア語",
}

INSTRUCTIONS = """\
あなたは音声翻訳の評価者です。ボイスインカム(業務用の無線のような音声連絡)のアプリで、
話者の音声を同時通訳のように逐次翻訳した結果を評価します。

- 「原文」は話者が話した内容の正しい書き起こしです。評価の基準は原文です。
- 「正解の訳」は人が作った訳の一例です。言い回しが違っても、意味が合っていれば減点しません。
- 「評価する訳」は、音声から直接作られた訳です。話し言葉らしい言い回し、語順の入れ替え、
  文の区切り方の違いは減点しません。
- 聞き手が原文と同じ用件を正しく受け取れるかで採点します。

点数:
5: 意味が完全に伝わる(言い換えは可)
4: 細部に小さな欠けやずれがあるが、用件は正しく伝わる
3: 重要な情報の一部が欠けるか誤っていて、聞き手が誤解しうる
2: 主要な意味の多くが欠けるか誤っている
1: 原文と無関係、または訳がない

誤りは、該当するものをすべて挙げます。説明は日本語で短く書きます。
"""


class TranslationError(BaseModel):
    type: Literal["omission", "addition", "mistranslation", "number_or_name", "fluency"] = Field(
        description="omission=原文の内容の欠け、addition=原文にない内容の付け足し、"
        "mistranslation=意味の取り違え、number_or_name=数字・固有名詞の誤り、fluency=不自然な訳文"
    )
    severity: Literal["minor", "major", "critical"]
    span: str = Field(description="評価する訳(欠けの場合は原文)の該当箇所")
    note: str = Field(description="誤りの説明(日本語で短く)")


class Judgement(BaseModel):
    score: int = Field(ge=1, le=5)
    errors: list[TranslationError]
    comment: str = Field(description="採点の理由(日本語で1文)")


async def judge_one(
    client: openai.AsyncOpenAI,
    row: dict,
    hypothesis: str,
    source_lang: str,
    target_lang: str,
    args: argparse.Namespace,
    sem: asyncio.Semaphore,
) -> dict:
    if not hypothesis.strip():
        return {"score": 1, "errors": [], "comment": "訳がない", "skipped": True}
    prompt = (
        f"原文({LANG_NAMES.get(source_lang, source_lang)}): {row['source']}\n"
        f"正解の訳({LANG_NAMES.get(target_lang, target_lang)}): {row['reference'] or '(なし)'}\n"
        f"評価する訳: {hypothesis}"
    )
    async with sem:
        res = await client.responses.parse(
            model=args.model,
            instructions=INSTRUCTIONS,
            input=prompt,
            reasoning={"effort": args.effort},
            text_format=Judgement,
        )
    j = res.output_parsed
    if j is None:
        return {"score": None, "errors": [], "comment": "採点に失敗", "skipped": True}
    usage = res.usage
    return {
        **j.model_dump(),
        "input_tokens": usage.input_tokens if usage else 0,
        "output_tokens": usage.output_tokens if usage else 0,
    }


def batch_langs(batch_dir: Path) -> tuple[str, str]:
    """runs/ の summary.json から、原文と訳の言語を読む。"""
    summary = next(batch_dir.glob("runs/*/*/summary.json"))
    a = json.loads(summary.read_text())["args"]
    return a["source_lang"], a["to"]


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("batch_dir", type=Path, help="eval_batch.py の出力ディレクトリ")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--effort", default="medium", help="reasoning effort")
    p.add_argument("--jobs", type=int, default=8)
    p.add_argument(
        "--self-check",
        action="store_true",
        help="正解の訳そのものも採点する(ほぼ5点になれば、採点が妥当だと見なせる)",
    )
    args = p.parse_args()

    rows = [
        json.loads(line) for line in (args.batch_dir / "results.jsonl").read_text().splitlines()
    ]
    source_lang, target_lang = batch_langs(args.batch_dir)
    client = openai.AsyncOpenAI()
    sem = asyncio.Semaphore(args.jobs)

    judged = await asyncio.gather(
        *(judge_one(client, r, r["hypothesis"], source_lang, target_lang, args, sem) for r in rows)
    )
    checks: list[dict] = []
    if args.self_check:
        checks = await asyncio.gather(
            *(
                judge_one(client, r, r["reference"], source_lang, target_lang, args, sem)
                for r in rows
                if r["reference"]
            )
        )

    out = args.batch_dir / "judged.jsonl"
    with out.open("w") as f:
        for r, j in zip(rows, judged, strict=True):
            f.write(json.dumps({**r, "judge": j, "judge_model": args.model}, ensure_ascii=False))
            f.write("\n")

    scores = [j["score"] for j in judged if j["score"] is not None]
    dist = Counter(scores)
    error_types = Counter(e["type"] for j in judged for e in j["errors"])
    severe = Counter(
        e["type"] for j in judged for e in j["errors"] if e["severity"] in ("major", "critical")
    )
    tokens_in = sum(j.get("input_tokens", 0) for j in judged + checks)
    tokens_out = sum(j.get("output_tokens", 0) for j in judged + checks)
    lines = [
        f"# 採点: {args.batch_dir.name}",
        "",
        f"- 採点したモデル: {args.model}(reasoning effort: {args.effort})",
        f"- 件数: {len(scores)}",
        f"- 平均: {statistics.mean(scores):.2f}、中央値: {statistics.median(scores)}",
        "- 分布: " + "、".join(f"{s}点 {dist.get(s, 0)}件" for s in range(5, 0, -1)),
        f"- 4点以上の割合: {sum(1 for s in scores if s >= 4) / len(scores):.0%}",
        "- 誤りの種類(すべて / major 以上): "
        + "、".join(f"{t} {error_types[t]} / {severe.get(t, 0)}" for t in error_types),
    ]
    if checks:
        cs = [c["score"] for c in checks if c["score"] is not None]
        lines.append(f"- 正解の訳そのものの採点(妥当性の確認): 平均 {statistics.mean(cs):.2f}")
    lines.append(f"- 使ったトークン: 入力 {tokens_in}、出力 {tokens_out}")

    # chrF と採点の関係(採点が chrF と違う見方をしているかの目安)
    by_score: dict[int, list[float]] = {}
    for r, j in zip(rows, judged, strict=True):
        if j["score"] is not None and r["chrf"] is not None:
            by_score.setdefault(j["score"], []).append(r["chrf"])
    lines += ["", "## 点数ごとの chrF の平均", ""]
    lines += [f"- {s}点: {statistics.mean(v):.1f}({len(v)}件)" for s, v in sorted(by_score.items())]

    lines += ["", "## 3点以下", ""]
    for r, j in sorted(zip(rows, judged, strict=True), key=lambda x: x[1]["score"] or 0):
        if (j["score"] or 0) > 3:
            continue
        lines += [
            f"- **{j['score']}点** `{r['id']}` {j['comment']}",
            f"  - 原文: {r['source']}",
            f"  - 正解: {r['reference']}",
            f"  - 出力: {r['hypothesis']}",
        ]
        lines += [f"  - [{e['severity']}] {e['type']}: {e['note']}" for e in j["errors"]]
    report = "\n".join(lines) + "\n"
    (args.batch_dir / "judge.md").write_text(report)
    print(report)


if __name__ == "__main__":
    asyncio.run(main())
