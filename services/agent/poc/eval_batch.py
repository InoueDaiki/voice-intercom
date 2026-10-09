"""manifest(fetch_datasets.py が作る一覧)の文をまとめて translate_bench.py に流す。

遅延と訳の質を集計する。訳の質は、正解の訳に対する chrF(文字 n-gram の一致度。0〜100)で見る。
日本語でも分かち書きが要らない。
原文の文字起こし(whisper)も、原文に対する chrF を出す。

使い方は poc/README.md を参照する。
"""

import argparse
import asyncio
import json
import statistics
import sys
import time
import wave
from pathlib import Path

import sacrebleu

POC_DIR = Path(__file__).parent
BENCH = POC_DIR / "translate_bench.py"


async def run_one(
    row: dict, to: str, run_dir: Path, extra: list[str], sem: asyncio.Semaphore
) -> dict | None:
    async with sem:
        cmd = [sys.executable, str(BENCH), str(POC_DIR / row["wav"]), "--to", to]
        cmd += ["--source-lang", row["source_lang"], "--out", str(run_dir), *extra]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        out, _ = await proc.communicate()
    summaries = sorted(run_dir.glob("*/summary.json"))
    if proc.returncode != 0 or not summaries:
        print(f"失敗: {row['id']}\n{out.decode()[-2000:]}", file=sys.stderr)
        return None
    summary = json.loads(summaries[-1].read_text())
    tr = summary["sessions"][f"translate-{to}"]
    wh = summary["sessions"].get("whisper", {})
    with wave.open(str(POC_DIR / row["wav"])) as w:
        duration = w.getnframes() / w.getframerate()
    ref = row["references"].get(to, "")
    hyp = tr["text"].strip()
    asr = wh.get("text", "").strip()
    print(f"{row['id']}: {hyp[:60]}")
    return {
        "id": row["id"],
        "duration_s": round(duration, 2),
        "first_text_s": tr["first_text_s"],
        "first_voice_s": tr["first_voice_s"],
        "last_voice_s": tr["last_voice_s"],
        "close_s": tr["close_s"],
        "voiced_s": tr["voiced_s"],
        "source": row["text"],
        "reference": ref,
        "hypothesis": hyp,
        "chrf": round(sacrebleu.sentence_chrf(hyp, [ref]).score, 1) if ref else None,
        "whisper": asr,
        "whisper_first_text_s": wh.get("first_text_s"),
        "whisper_chrf": round(sacrebleu.sentence_chrf(asr, [row["text"]]).score, 1) if wh else None,
        "errors": tr["errors"] + wh.get("errors", []),
    }


def stats(values: list[float | None]) -> str:
    v = sorted(x for x in values if x is not None)
    if not v:
        return "-"
    p90 = v[min(len(v) - 1, round(len(v) * 0.9) - 1)]
    return f"中央値 {statistics.median(v):.2f} / p90 {p90:.2f} / 最大 {v[-1]:.2f}"


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("manifest", type=Path)
    p.add_argument("--to", required=True, help="翻訳先の言語")
    p.add_argument("--limit", type=int, help="先頭から何件だけ流すか")
    p.add_argument("--jobs", type=int, default=3, help="同時に流す件数")
    p.add_argument("--no-whisper", action="store_true")
    p.add_argument("--noise-reduction", choices=["near_field", "far_field", "none"], default="none")
    args = p.parse_args()

    rows = [json.loads(line) for line in args.manifest.read_text().splitlines() if line]
    rows = [r for r in rows if r["source_lang"] != args.to][: args.limit]
    name = (
        f"{args.manifest.parent.parent.name}-{args.manifest.parent.name}-to-{args.to}"
        f"-nr-{args.noise_reduction}"
    )
    batch_dir = POC_DIR / "out" / f"batch-{time.strftime('%Y%m%d-%H%M%S')}-{name}"
    extra = ["--noise-reduction", args.noise_reduction]
    if args.no_whisper:
        extra.append("--no-whisper")

    sem = asyncio.Semaphore(args.jobs)
    results = await asyncio.gather(
        *(run_one(r, args.to, batch_dir / "runs" / r["id"], extra, sem) for r in rows)
    )
    ok = [r for r in results if r is not None]
    with (batch_dir / "results.jsonl").open("w") as f:
        for r in ok:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    scored = [r for r in ok if r["reference"]]
    corpus = sacrebleu.corpus_chrf(
        [r["hypothesis"] for r in scored], [[r["reference"] for r in scored]]
    )
    lines = [
        f"# {name}",
        "",
        f"- 件数: {len(ok)} / {len(rows)}(失敗 {len(rows) - len(ok)})",
        f"- 入力の長さ(秒): {stats([r['duration_s'] for r in ok])}",
        f"- 初回の字(秒): {stats([r['first_text_s'] for r in ok])}",
        f"- 初回の声(秒): {stats([r['first_voice_s'] for r in ok])}",
        f"- 最後の声(発話の終了から、秒): {stats([r['last_voice_s'] for r in ok])}",
        f"- 訳が出なかった: {sum(1 for r in ok if not r['hypothesis'])} 件、"
        f"翻訳音声が出なかった: {sum(1 for r in ok if r['first_voice_s'] is None)} 件",
        f"- 訳の chrF(全体): {corpus.score:.1f}",
    ]
    if not args.no_whisper:
        asr_chrf = [r["whisper_chrf"] for r in ok if r["whisper_chrf"] is not None]
        lines += [
            f"- whisper の初回の字(秒): {stats([r['whisper_first_text_s'] for r in ok])}",
            f"- whisper の chrF(原文に対して、中央値): {statistics.median(asr_chrf):.1f}",
        ]
    worst = sorted(scored, key=lambda r: r["chrf"])[:5]
    lines += ["", "## chrF が低い5件", ""]
    for r in worst:
        lines += [
            f"- **{r['chrf']}** `{r['id']}`",
            f"  - 原文: {r['source']}",
            f"  - 正解: {r['reference']}",
            f"  - 出力: {r['hypothesis']}",
        ]
    report = "\n".join(lines) + "\n"
    (batch_dir / "report.md").write_text(report)
    print("\n" + report + f"\n保存先: {batch_dir}")


if __name__ == "__main__":
    asyncio.run(main())
