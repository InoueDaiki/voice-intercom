// ブラウザの speechSynthesis で翻訳後のテキストを読み上げる案の PoC のページ。
// 待ち行列と速さの決め方は src/core(DOM を使わない。Vitest で試す)にあり、ここは画面と speechSynthesis をつなぐだけ。
// 時刻はすべて、ページを開いてからのミリ秒(performance.now())で記録する。

import { LANGUAGES, groupVoices, type LangCode, type Language } from "./core/languages.ts";
import {
  DEFAULT_CHARS_PER_SEC,
  DEFAULT_POLICY,
  PacingQueue,
  buildFeed,
  countChars,
  estimateSeconds,
  observedCharsPerSec,
  simulate,
  summarize,
  type PacingPolicy,
  type Segment,
  type SegmentResult,
} from "./core/pacing.ts";
import { remainingText, snapToWordStart } from "./core/text.ts";
import { SAMPLES } from "./samples.ts";

// ---------------------------------------------------------------------------
// 小さな道具

type Child = Node | string | number | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> | Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const t0 = performance.now();
/** ページを開いてからのミリ秒 */
const now = () => Math.round(performance.now() - t0);
const sec = (ms: number | null | undefined, digits = 2) =>
  ms === null || ms === undefined ? "" : (ms / 1000).toFixed(digits);
const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : n.toFixed(digits);

const LANG_BY_CODE = new Map<LangCode, Language>(LANGUAGES.map((l) => [l.code, l]));
const langOf = (code: LangCode) => LANG_BY_CODE.get(code) as Language;

// ---------------------------------------------------------------------------
// ログ(JSON で書き出す)

interface LogEntry {
  t: number;
  at: string;
  kind: string;
  [key: string]: unknown;
}

const logs: LogEntry[] = [];
const logEl = h("pre", { className: "log" });

function log(kind: string, data: Record<string, unknown> = {}): void {
  const entry: LogEntry = { t: now(), at: new Date().toISOString(), kind, ...data };
  logs.push(entry);
  const line = `${sec(entry.t, 3).padStart(9)}s ${kind} ${JSON.stringify(data)}\n`;
  logEl.append(line);
  while (logEl.childNodes.length > 400) logEl.firstChild?.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

// 書き出す結果
const results = {
  permission: [] as Record<string, unknown>[],
  samples: [] as Record<string, unknown>[],
  queueRuns: [] as Record<string, unknown>[],
  boundary: [] as Record<string, unknown>[],
  cancel: [] as Record<string, unknown>[],
};

// ---------------------------------------------------------------------------
// speechSynthesis のまわり

const synth: SpeechSynthesis | undefined = "speechSynthesis" in window ? window.speechSynthesis : undefined;
let voices: SpeechSynthesisVoice[] = [];

const voiceInfo = (v: SpeechSynthesisVoice | null) =>
  v ? { name: v.name, lang: v.lang, localService: v.localService, default: v.default, voiceURI: v.voiceURI } : null;

interface BoundaryRecord {
  name: string;
  charIndex: number;
  elapsedTime: number;
  t: number;
}

interface SpeakResult {
  tag: string;
  text: string;
  lang: LangCode;
  voice: string | null;
  rate: number;
  speakAt: number;
  startAt: number | null;
  endAt: number | null;
  /** end: 読み終えた / error: error イベント / no-start: 始まらなかった / timeout: end が来なかった */
  outcome: "end" | "error" | "no-start" | "timeout";
  error?: string;
  boundaries: BoundaryRecord[];
}

interface SpeakOptions {
  text: string;
  lang: LangCode;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  tag: string;
  onBoundary?: (b: BoundaryRecord) => void;
}

// Chrome は、参照の切れた utterance を GC して end を出さないことがあるので、読み終えるまで持っておく
const alive = new Set<SpeechSynthesisUtterance>();

/** 1つの文を TTS に渡す。end・error・始まらない・end が来ない、のどれかで done が解決する */
function speak(o: SpeakOptions): { utterance: SpeechSynthesisUtterance; done: Promise<SpeakResult> } {
  const u = new SpeechSynthesisUtterance(o.text);
  if (o.voice) {
    u.voice = o.voice;
    u.lang = o.voice.lang;
  } else {
    u.lang = langOf(o.lang).tag;
  }
  u.rate = o.rate;
  alive.add(u);
  const r: SpeakResult = {
    tag: o.tag,
    text: o.text,
    lang: o.lang,
    voice: o.voice?.name ?? null,
    rate: o.rate,
    speakAt: 0,
    startAt: null,
    endAt: null,
    outcome: "end",
    boundaries: [],
  };
  const estMs = estimateSeconds(o.text, o.lang, DEFAULT_CHARS_PER_SEC[o.lang], o.rate) * 1000;
  const done = new Promise<SpeakResult>((resolve) => {
    let settled = false;
    const timers: number[] = [];
    const finish = (outcome: SpeakResult["outcome"], error?: string) => {
      if (settled) return;
      settled = true;
      for (const id of timers) clearTimeout(id);
      r.outcome = outcome;
      if (error !== undefined) r.error = error;
      alive.delete(u);
      log(outcome, {
        tag: o.tag,
        ...(error ? { error } : {}),
        durationMs: r.startAt !== null && r.endAt !== null ? r.endAt - r.startAt : null,
        boundaries: r.boundaries.length,
      });
      resolve(r);
    };
    u.onstart = () => {
      r.startAt = now();
      log("start", { tag: o.tag, afterSpeakMs: r.startAt - r.speakAt });
    };
    u.onend = () => {
      r.endAt = now();
      finish("end");
    };
    u.onerror = (e) => {
      r.endAt = now();
      finish("error", e.error);
    };
    u.onboundary = (e) => {
      const b = { name: e.name, charIndex: e.charIndex, elapsedTime: e.elapsedTime, t: now() };
      r.boundaries.push(b);
      o.onBoundary?.(b);
    };
    // 5秒たっても始まらず、何も読んでいなければ、鳴らなかったとみなす
    timers.push(
      window.setTimeout(() => {
        if (r.startAt !== null) return;
        log("warn", { tag: o.tag, message: "5秒たっても start が来ない", speaking: synth?.speaking, pending: synth?.pending });
        if (!synth?.speaking) finish("no-start");
      }, 5000),
    );
    // 見積もりの3倍 + 10秒たっても end が来なければ打ち切る
    timers.push(window.setTimeout(() => finish("timeout"), estMs * 3 + 10_000));
  });
  r.speakAt = now();
  log("speak", { tag: o.tag, voice: o.voice?.name ?? `(lang=${u.lang})`, rate: o.rate, chars: countChars(o.text, o.lang) });
  synth?.speak(u);
  return { utterance: u, done };
}

// ---------------------------------------------------------------------------
// 言語・声・速さの選択(画面の上に固定する)

const state = {
  lang: "ja" as LangCode,
  /** voices の添字。null なら声を選ばず lang だけを指定する */
  voiceIndex: null as number | null,
  rate: 1.0,
  useCalibration: true,
};

/** 声ごとの実測(1.0倍に直した1秒あたりの文字数) */
const calibration = new Map<string, number[]>();
const voiceKey = (lang: LangCode, v: SpeechSynthesisVoice | null) => (v ? `${v.voiceURI}|${v.name}` : `default|${lang}`);

function selectedVoice(): SpeechSynthesisVoice | null {
  return state.voiceIndex === null ? null : (voices[state.voiceIndex] ?? null);
}

function charsPerSec(lang: LangCode, v: SpeechSynthesisVoice | null): { value: number; measured: boolean } {
  const xs = calibration.get(voiceKey(lang, v));
  if (state.useCalibration && xs && xs.length > 0) {
    return { value: xs.reduce((a, b) => a + b, 0) / xs.length, measured: true };
  }
  return { value: DEFAULT_CHARS_PER_SEC[lang], measured: false };
}

function addCalibration(r: SpeakResult, v: SpeechSynthesisVoice | null): number | null {
  if (r.outcome !== "end" || r.startAt === null || r.endAt === null) return null;
  const cps = observedCharsPerSec(r.text, r.lang, (r.endAt - r.startAt) / 1000, r.rate);
  if (cps === null) return null;
  const key = voiceKey(r.lang, v);
  calibration.set(key, [...(calibration.get(key) ?? []), cps]);
  return cps;
}

const langSelect = h(
  "select",
  {},
  ...LANGUAGES.map((l) => h("option", { value: l.code, textContent: `${l.name}(${l.code})` })),
);
langSelect.value = state.lang;
const voiceSelect = h("select", { style: "max-width: 22em" });
const rateInput = h("input", { type: "range", min: "0.5", max: "2", step: "0.05", value: "1" });
const rateLabel = h("span", { textContent: "1.00" });
const cpsLabel = h("span");
const synthState = h("span");
const calibCheck = h("input", { type: "checkbox", checked: true });

function voicesOfLang(lang: LangCode): { v: SpeechSynthesisVoice; i: number }[] {
  const { byLanguage } = groupVoices(voices);
  const list = byLanguage.get(lang) ?? [];
  return list.map((v) => ({ v, i: voices.indexOf(v) }));
}

function renderVoiceSelect(): void {
  const list = voicesOfLang(state.lang);
  voiceSelect.replaceChildren(
    h("option", { value: "", textContent: `(声を選ばず lang=${langOf(state.lang).tag} だけ)` }),
    ...list.map(({ v, i }) =>
      h("option", {
        value: String(i),
        textContent: `${v.name}(${v.lang}${v.localService ? "" : "、ネットワーク"}${v.default ? "、default" : ""})`,
      }),
    ),
  );
  const keep = state.voiceIndex !== null && list.some(({ i }) => i === state.voiceIndex);
  if (!keep) state.voiceIndex = list[0]?.i ?? null;
  voiceSelect.value = state.voiceIndex === null ? "" : String(state.voiceIndex);
  renderCps();
}

function renderCps(): void {
  const c = charsPerSec(state.lang, selectedVoice());
  cpsLabel.textContent = `見積もり ${c.value.toFixed(1)} 文字/秒(${c.measured ? "実測" : "初期値"})`;
}

langSelect.onchange = () => {
  state.lang = langSelect.value as LangCode;
  renderVoiceSelect();
  renderSampleButtons();
  log("select", { lang: state.lang });
};
voiceSelect.onchange = () => {
  state.voiceIndex = voiceSelect.value === "" ? null : Number(voiceSelect.value);
  renderCps();
  log("select", { voice: voiceInfo(selectedVoice()) });
};
rateInput.oninput = () => {
  state.rate = Number(rateInput.value);
  rateLabel.textContent = state.rate.toFixed(2);
};
calibCheck.onchange = () => {
  state.useCalibration = calibCheck.checked;
  renderCps();
};

const header = h(
  "div",
  { className: "sticky" },
  h(
    "div",
    { className: "controls" },
    h("label", {}, "言語", langSelect),
    h("label", {}, "声", voiceSelect),
    h("label", {}, "速さ", rateInput, rateLabel),
    h("button", { textContent: "止める(cancel)", onclick: () => synth?.cancel() }),
  ),
  h(
    "div",
    { className: "controls" },
    synthState,
    cpsLabel,
    h("label", {}, calibCheck, "読み上げた実測で見積もる"),
  ),
);

setInterval(() => {
  synthState.textContent = synth
    ? `speaking=${synth.speaking} pending=${synth.pending} paused=${synth.paused}`
    : "このブラウザには speechSynthesis が無い";
}, 250);

// ---------------------------------------------------------------------------
// 1. 読み上げの許可

const permissionOut = h("tbody");

function recordPermission(test: string, r: SpeakResult): void {
  const row = {
    test,
    outcome: r.outcome,
    error: r.error ?? null,
    startAfterSpeakMs: r.startAt === null ? null : r.startAt - r.speakAt,
    userActivation: navigator.userActivation?.hasBeenActive ?? null,
    visibility: document.visibilityState,
  };
  results.permission.push(row);
  permissionOut.append(
    h(
      "tr",
      {},
      h("td", {}, test),
      h("td", { className: r.outcome === "end" ? "" : "warn" }, r.outcome),
      h("td", {}, r.error ?? ""),
      h("td", { className: "num" }, row.startAfterSpeakMs ?? ""),
      h("td", {}, String(row.userActivation)),
    ),
  );
}

async function permissionTest(test: string, text: string): Promise<void> {
  if (!synth) return;
  const { done } = speak({ text, lang: state.lang, voice: selectedVoice(), rate: 1, tag: `permission:${test}` });
  recordPermission(test, await done);
}

const visibilityCheck = h("input", { type: "checkbox" });
document.addEventListener("visibilitychange", () => {
  log("visibility", { state: document.visibilityState });
  if (document.visibilityState === "visible" && visibilityCheck.checked) {
    void permissionTest("タブに戻った直後(操作なし)", SAMPLES[state.lang].short);
  }
});

const permissionSection = h(
  "section",
  {},
  h("h2", {}, "1. 読み上げの許可"),
  h(
    "p",
    { className: "note" },
    "ページを開いて2秒後に、操作なしで speak() を1回呼ぶ(下の表の「開いた直後」)。鳴ったか、error(not-allowed など)が来たかを見る。",
    "そのあと「解除」を押し、タイマーから(操作の外で)鳴るかを試す。",
  ),
  h(
    "div",
    { className: "controls" },
    h("button", {
      textContent: "解除(空の文を speak)",
      onclick: () => void permissionTest("解除: 空の文(操作の中)", ""),
    }),
    h("button", {
      textContent: "解除(短い文を speak)",
      onclick: () => void permissionTest("解除: 短い文(操作の中)", SAMPLES[state.lang].short),
    }),
    h("button", {
      textContent: "3秒後にタイマーから speak",
      onclick: () => {
        log("timer-armed", {});
        window.setTimeout(() => void permissionTest("タイマーから(操作の外)", SAMPLES[state.lang].short), 3000);
      },
    }),
    h("label", {}, visibilityCheck, "タブに戻ったら speak する(タブや App を切り替えて戻る)"),
  ),
  h(
    "div",
    { className: "table-wrap" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h("tr", {}, ...["試したこと", "結果", "error", "speak→start(ms)", "操作済み"].map((s) => h("th", {}, s))),
      ),
      permissionOut,
    ),
  ),
);

// ---------------------------------------------------------------------------
// 2. 声の一覧

const voicesOut = h("div");

function renderVoices(): void {
  const { byLanguage, others } = groupVoices(voices);
  const missing = LANGUAGES.filter((l) => (byLanguage.get(l.code) ?? []).length === 0);
  voicesOut.replaceChildren(
    h("p", {}, `声は全部で ${voices.length}。13言語に当たらない声は ${others.length}。`),
    h(
      "p",
      { className: missing.length ? "missing" : "" },
      missing.length ? `声が無い言語: ${missing.map((l) => l.name).join("、")}` : "13言語すべてに声がある。",
    ),
    h(
      "div",
      { className: "table-wrap" },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h("tr", {}, ...["言語", "数", "名前", "lang", "localService", "default", "voiceURI"].map((s) => h("th", {}, s))),
        ),
        h(
          "tbody",
          {},
          ...LANGUAGES.flatMap((l) => {
            const list = byLanguage.get(l.code) ?? [];
            if (list.length === 0) {
              return [
                h(
                  "tr",
                  {},
                  h("td", { className: "missing" }, `${l.name}(${l.code})`),
                  h("td", { className: "num missing" }, 0),
                  h("td", { colSpan: 5, className: "missing" }, "声が無い"),
                ),
              ];
            }
            return list.map((v, i) =>
              h(
                "tr",
                {},
                i === 0 ? h("td", { rowSpan: list.length }, `${l.name}(${l.code})`) : null,
                i === 0 ? h("td", { rowSpan: list.length, className: "num" }, list.length) : null,
                h("td", {}, v.name),
                h("td", {}, v.lang),
                h("td", {}, String(v.localService)),
                h("td", {}, v.default ? "true" : ""),
                h("td", {}, v.voiceURI),
              ),
            );
          }),
        ),
      ),
    ),
    h(
      "details",
      {},
      h("summary", {}, `13言語に当たらない声(${others.length})`),
      h("p", { className: "note" }, others.map((v) => `${v.name}(${v.lang})`).join("、")),
    ),
  );
}

function loadVoices(reason: string): void {
  if (!synth) return;
  const next = synth.getVoices();
  if (next.length === voices.length && next.every((v, i) => v === voices[i])) return;
  voices = next;
  log("voices", { reason, count: voices.length });
  renderVoices();
  renderVoiceSelect();
}

const voicesSection = h(
  "section",
  {},
  h("h2", {}, "2. 声の一覧(13言語)"),
  h(
    "p",
    { className: "note" },
    "getVoices() の中身。声は後から届くことがある(voiceschanged)。localService=false はネットワークの声。",
  ),
  h("div", { className: "controls" }, h("button", { textContent: "読み直す", onclick: () => loadVoices("button") })),
  voicesOut,
);

// ---------------------------------------------------------------------------
// 3. 例文の読み上げ

const sampleButtons = h("div", { className: "controls" });
const sampleOut = h("tbody");

async function speakSample(label: string, text: string, lang = state.lang, voice = selectedVoice()): Promise<SpeakResult | null> {
  if (!synth) return null;
  const { done } = speak({ text, lang, voice, rate: state.rate, tag: `sample:${lang}:${label}` });
  const r = await done;
  const cps = addCalibration(r, voice);
  renderCps();
  const durationMs = r.startAt !== null && r.endAt !== null ? r.endAt - r.startAt : null;
  results.samples.push({
    label,
    lang,
    voice: voiceInfo(voice),
    rate: r.rate,
    chars: countChars(text, lang),
    outcome: r.outcome,
    error: r.error ?? null,
    startAfterSpeakMs: r.startAt === null ? null : r.startAt - r.speakAt,
    durationMs,
    charsPerSecAt1x: cps,
    boundaries: r.boundaries.length,
  });
  sampleOut.prepend(
    h(
      "tr",
      {},
      h("td", {}, lang),
      h("td", {}, voice?.name ?? "(lang だけ)"),
      h("td", {}, label),
      h("td", { className: "num" }, r.rate.toFixed(2)),
      h("td", { className: r.outcome === "end" ? "" : "warn" }, r.outcome + (r.error ? `(${r.error})` : "")),
      h("td", { className: "num" }, r.startAt === null ? "" : r.startAt - r.speakAt),
      h("td", { className: "num" }, sec(durationMs)),
      h("td", { className: "num" }, fmt(cps, 1)),
      h("td", { className: "num" }, r.boundaries.length),
    ),
  );
  return r;
}

function renderSampleButtons(): void {
  const s = SAMPLES[state.lang];
  sampleButtons.replaceChildren(
    h("button", { textContent: "短文", title: s.short, onclick: () => void speakSample("短文", s.short) }),
    h("button", { textContent: "長めの文", title: s.long, onclick: () => void speakSample("長めの文", s.long) }),
    ...s.speech.map((text, i) =>
      h("button", { textContent: `区切り${i + 1}`, title: text, onclick: () => void speakSample(`区切り${i + 1}`, text) }),
    ),
  );
  sampleText.replaceChildren(
    h("li", {}, `短文: ${s.short}`),
    h("li", {}, `長めの文: ${s.long}`),
    ...s.speech.map((t, i) => h("li", {}, `区切り${i + 1}: ${t}`)),
  );
}

const sampleText = h("ul", { className: "note" });

let allLangsRunning = false;
async function speakAllLanguages(): Promise<void> {
  if (allLangsRunning) return;
  allLangsRunning = true;
  try {
    const { byLanguage } = groupVoices(voices);
    for (const l of LANGUAGES) {
      const list = byLanguage.get(l.code) ?? [];
      const v = list.find((x) => x.default) ?? list.find((x) => x.localService) ?? list[0] ?? null;
      if (!v) {
        log("skip", { lang: l.code, message: "声が無い" });
        continue;
      }
      await speakSample("短文(13言語を順に)", SAMPLES[l.code].short, l.code, v);
    }
  } finally {
    allLangsRunning = false;
  }
}

const samplesSection = h(
  "section",
  {},
  h("h2", {}, "3. 例文の読み上げ"),
  h(
    "p",
    { className: "note" },
    "上で選んだ言語・声・速さで読む。読み終えると、1.0倍に直した1秒あたりの文字数を実測し、待ち行列の見積もりに使う(声ごと)。",
    "ボタンにカーソルを合わせると文が出る。訳文は PoC 用に用意したもの。",
  ),
  sampleButtons,
  h(
    "div",
    { className: "controls" },
    h("button", { textContent: "13言語の短文を順に読む(各言語の default か最初の声)", onclick: () => void speakAllLanguages() }),
  ),
  h("details", {}, h("summary", {}, "この言語の例文"), sampleText),
  h(
    "div",
    { className: "table-wrap" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...["lang", "声", "文", "速さ", "結果", "speak→start(ms)", "長さ(s)", "文字/秒(1.0倍)", "boundary"].map((s) =>
            h("th", {}, s),
          ),
        ),
      ),
      sampleOut,
    ),
  ),
);

// ---------------------------------------------------------------------------
// 4. 待ち行列と速さの決め方

const num = (value: number, step = "0.1", min = "0") => h("input", { type: "number", value: String(value), step, min });
const q = {
  minRate: num(DEFAULT_POLICY.minRate, "0.05"),
  maxRate: num(DEFAULT_POLICY.maxRate, "0.05"),
  low: num(DEFAULT_POLICY.lowBacklogSec, "0.5"),
  high: num(DEFAULT_POLICY.highBacklogSec, "0.5"),
  drop: num(DEFAULT_POLICY.dropAfterSec, "1"),
  firstDelay: num(6, "0.5"),
  interval: num(4, "0.5"),
  intervalMode: h(
    "select",
    {},
    h("option", { value: "fixed", textContent: "決まった間隔(秒)" }),
    h("option", { value: "scaled", textContent: "文の長さ × 係数(1.0倍で読む秒数に掛ける)" }),
  ),
  repeat: num(2, "1", "1"),
};

function readPolicy(): PacingPolicy {
  return {
    minRate: Number(q.minRate.value),
    maxRate: Number(q.maxRate.value),
    lowBacklogSec: Number(q.low.value),
    highBacklogSec: Number(q.high.value),
    rateStep: DEFAULT_POLICY.rateStep,
    dropAfterSec: Number(q.drop.value),
  };
}

function makeFeed(cps: number): { feed: Segment[]; params: Record<string, unknown> } {
  const texts = Array.from({ length: Math.max(1, Number(q.repeat.value)) }, () => SAMPLES[state.lang].speech).flat();
  const mode = q.intervalMode.value;
  const interval = Number(q.interval.value);
  const firstDelay = Number(q.firstDelay.value);
  const feed = buildFeed(texts, state.lang, 0, firstDelay, (_i, text) =>
    mode === "fixed" ? interval : estimateSeconds(text, state.lang, cps) * interval,
  );
  return { feed, params: { firstDelaySec: firstDelay, intervalMode: mode, interval, repeat: Number(q.repeat.value) } };
}

type LiveResult = SegmentResult & { outcome?: string; error?: string; boundaries?: number };

const queueStatus = h("p");
const queueSummary = h("p");
const queueTable = h("tbody");
let activeRun: LiveRun | null = null;

function renderQueueResults(rows: readonly LiveResult[], speakingId: string | null): void {
  queueTable.replaceChildren(
    ...rows.map((r) => {
      const wait = r.startAt !== undefined ? r.startAt - r.arrivedAt : undefined;
      const lag = r.endAt !== undefined ? r.endAt - r.arrivedAt : undefined;
      const status = r.dropped ? "飛ばした" : (r.outcome ?? (r.speakAt !== undefined ? "読んでいる" : ""));
      return h(
        "tr",
        { className: r.id === speakingId ? "speaking" : "" },
        h("td", {}, r.id),
        h("td", { title: r.text }, r.text.length > 24 ? `${r.text.slice(0, 24)}…` : r.text),
        h("td", { className: "num" }, sec(r.arrivedAt, 1)),
        h("td", { className: "num" }, sec(r.speakAt, 1)),
        h("td", { className: "num" }, sec(r.startAt, 1)),
        h("td", { className: "num" }, sec(r.endAt, 1)),
        h("td", { className: "num" }, fmt(r.backlogSec, 1)),
        h("td", { className: "num" }, r.queued ?? ""),
        h("td", { className: "num" }, fmt(r.rate)),
        h("td", { className: "num" }, sec(wait, 1)),
        h("td", { className: "num" }, sec(lag, 1)),
        h("td", { className: r.outcome && r.outcome !== "end" ? "warn" : "" }, status),
      );
    }),
  );
  const s = summarize(rows);
  queueSummary.textContent =
    `読んだ ${s.spoken} / 飛ばした ${s.dropped} / ` +
    `遅れ(届いてから読み終えるまで)の最大 ${fmt(s.maxLagSec, 1)}秒、最後の区切り ${fmt(s.lastLagSec, 1)}秒 / ` +
    `待ち(届いてから読み始めるまで)の最大 ${fmt(s.maxWaitSec, 1)}秒 / 速さの平均 ${fmt(s.meanRate)}`;
}

/** 実際の声で、字幕が数秒ごとに届くのを模擬して読み上げる */
class LiveRun {
  private readonly rows: LiveResult[];
  private readonly byId: Map<string, LiveResult>;
  private readonly queue: PacingQueue;
  private readonly timers: number[] = [];
  private base = 0;
  private speakingId: string | null = null;
  private arrived = 0;
  private stopped = false;

  constructor(
    private readonly feed: Segment[],
    private readonly policy: PacingPolicy,
    private readonly voice: SpeechSynthesisVoice | null,
    private readonly cps: number,
    private readonly meta: Record<string, unknown>,
  ) {
    // 届く前は arrivedAt を予定の時刻にしておき、届いたら実際の時刻で上書きする
    this.rows = feed.map((s) => ({ id: s.id, text: s.text, arrivedAt: s.arrivedAt, dropped: false }));
    this.byId = new Map(this.rows.map((r) => [r.id, r]));
    this.queue = new PacingQueue(policy, (s) => estimateSeconds(s.text, s.lang, cps));
  }

  private t(): number {
    return now() - this.base;
  }

  start(): void {
    this.base = now();
    log("queue-run-start", { ...this.meta, policy: this.policy, cps: this.cps, segments: this.feed.length });
    for (const seg of this.feed) {
      this.timers.push(window.setTimeout(() => this.arrive(seg), seg.arrivedAt));
    }
    this.render();
  }

  private arrive(seg: Segment): void {
    if (this.stopped) return;
    const at = this.t();
    const row = this.byId.get(seg.id);
    if (row) row.arrivedAt = at;
    this.arrived += 1;
    this.queue.enqueue({ ...seg, arrivedAt: at });
    log("arrive", { id: seg.id, runT: at, queued: this.queue.size, backlogSec: Number(this.queue.backlogSec().toFixed(2)) });
    if (this.speakingId === null) this.pump();
    this.render();
  }

  private pump(): void {
    if (this.stopped) return;
    const { next, dropped } = this.queue.takeNext(this.t());
    for (const d of dropped) {
      const row = this.byId.get(d.id);
      if (row) row.dropped = true;
      log("drop", { id: d.id, waitedSec: (this.t() - d.arrivedAt) / 1000 });
    }
    if (!next) {
      this.speakingId = null;
      if (this.arrived === this.feed.length) this.finish("done");
      this.render();
      return;
    }
    const row = this.byId.get(next.segment.id) as LiveResult;
    Object.assign(row, { rate: next.rate, backlogSec: next.backlogSec, queued: next.queued, speakAt: this.t() });
    this.speakingId = row.id;
    const { done } = speak({
      text: next.segment.text,
      lang: next.segment.lang,
      voice: this.voice,
      rate: next.rate,
      tag: `queue:${row.id}`,
    });
    void done.then((r) => {
      if (r.startAt !== null) row.startAt = r.startAt - this.base;
      row.endAt = (r.endAt ?? now()) - this.base;
      row.outcome = r.outcome;
      if (r.error) row.error = r.error;
      row.boundaries = r.boundaries.length;
      if (r.outcome === "timeout") synth?.cancel();
      if (this.stopped) return;
      this.speakingId = null;
      this.pump();
      this.render();
    });
    this.render();
  }

  stop(): void {
    if (this.stopped) return;
    for (const id of this.timers) clearTimeout(id);
    this.finish("stopped");
    synth?.cancel();
  }

  private finish(reason: string): void {
    this.stopped = true;
    const summary = summarize(this.rows);
    results.queueRuns.push({
      kind: "live",
      reason,
      lang: state.lang,
      voice: voiceInfo(this.voice),
      ...this.meta,
      policy: this.policy,
      charsPerSecAt1x: this.cps,
      summary,
      segments: this.rows,
    });
    log("queue-run-end", { reason, summary });
    if (activeRun === this) activeRun = null;
    this.render();
  }

  render(): void {
    const t = this.stopped ? null : this.t();
    queueStatus.textContent = this.stopped
      ? "終わり"
      : `経過 ${sec(t, 1)}秒 / 届いた ${this.arrived}/${this.feed.length} / 待ち行列 ${this.queue.size}(${fmt(this.queue.backlogSec(), 1)}秒ぶん)`;
    renderQueueResults(this.rows, this.stopped ? null : this.speakingId);
  }
}

function startLiveRun(): void {
  if (!synth) return;
  activeRun?.stop();
  const voice = selectedVoice();
  const cps = charsPerSec(state.lang, voice);
  const { feed, params } = makeFeed(cps.value);
  activeRun = new LiveRun(feed, readPolicy(), voice, cps.value, { ...params, cpsMeasured: cps.measured });
  activeRun.start();
}

function runSimulation(): void {
  activeRun?.stop();
  const voice = selectedVoice();
  const cps = charsPerSec(state.lang, voice);
  const { feed, params } = makeFeed(cps.value);
  const policy = readPolicy();
  const est = (s: Segment) => estimateSeconds(s.text, s.lang, cps.value);
  const rows = simulate(feed, policy, est, (s, rate) => est(s) / rate);
  results.queueRuns.push({
    kind: "simulation",
    lang: state.lang,
    voice: voiceInfo(voice),
    ...params,
    policy,
    charsPerSecAt1x: cps.value,
    cpsMeasured: cps.measured,
    summary: summarize(rows),
    segments: rows,
  });
  log("simulation", { lang: state.lang, summary: summarize(rows) });
  queueStatus.textContent = "声を使わない模擬(見積もりどおりに読めたとした場合)";
  renderQueueResults(rows, null);
}

const queueSection = h(
  "section",
  {},
  h("h2", {}, "4. 待ち行列と速さの決め方"),
  h(
    "p",
    { className: "note" },
    "選んだ言語の長い発話(区切り1〜7を「繰り返し」回)を、最初は「最初の遅れ」秒後、そのあと間隔ごとに1区切りずつ届かせる。",
    "待ち行列はページが持ち、TTS には1区切りずつ渡す。前の区切りを読み終えた時点(何も読んでいなければ届いた時点)の待ちの量で、次の速さを決める。",
    "待ちの量は、待ち行列にある区切り(次に渡すものを含む)を1.0倍で読む秒数の見積もりの合計。待ちが「少ない」以下なら最小の速さ、「多い」以上なら最大、間は直線。",
  ),
  h(
    "div",
    { className: "controls" },
    h("label", {}, "速さ 最小", q.minRate),
    h("label", {}, "最大", q.maxRate),
    h("label", {}, "待ちが少ない(秒)", q.low),
    h("label", {}, "多い(秒)", q.high),
    h("label", {}, "この秒数より待ったら飛ばす(0 は飛ばさない)", q.drop),
  ),
  h(
    "div",
    { className: "controls" },
    h("label", {}, "最初の遅れ(秒)", q.firstDelay),
    h("label", {}, "間隔", q.intervalMode, q.interval),
    h("label", {}, "繰り返し", q.repeat),
  ),
  h(
    "div",
    { className: "controls" },
    h("button", { textContent: "声で試す", onclick: startLiveRun }),
    h("button", { textContent: "止める", onclick: () => activeRun?.stop() }),
    h("button", { textContent: "声なしで模擬(見積もりだけ)", onclick: runSimulation }),
  ),
  queueStatus,
  queueSummary,
  h(
    "div",
    { className: "table-wrap" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...[
            "#",
            "文",
            "届いた",
            "渡した",
            "読み始め",
            "読み終え",
            "待ちの量(秒)",
            "待ち行列",
            "速さ",
            "待ち",
            "遅れ",
            "結果",
          ].map((s) => h("th", {}, s)),
        ),
      ),
      queueTable,
    ),
  ),
  h("p", { className: "note" }, "時刻は試し始めてからの秒。待ち = 届いてから読み始めるまで、遅れ = 届いてから読み終えるまで。"),
);

// ---------------------------------------------------------------------------
// 5. boundary イベント(声ごと)

const boundaryOut = h("tbody");
let boundaryRunning = false;

async function boundaryTest(): Promise<void> {
  if (!synth || boundaryRunning) return;
  boundaryRunning = true;
  try {
    const list: (SpeechSynthesisVoice | null)[] = [...voicesOfLang(state.lang).map(({ v }) => v), null];
    const text = SAMPLES[state.lang].short;
    for (const v of list) {
      const { done } = speak({ text, lang: state.lang, voice: v, rate: 1, tag: `boundary:${v?.name ?? "lang"}` });
      const r = await done;
      const words = r.boundaries.filter((b) => b.name === "word").length;
      const sentences = r.boundaries.filter((b) => b.name === "sentence").length;
      const first = r.boundaries[0];
      const row = {
        lang: state.lang,
        voice: voiceInfo(v),
        outcome: r.outcome,
        error: r.error ?? null,
        word: words,
        sentence: sentences,
        firstBoundaryAfterStartMs: first && r.startAt !== null ? first.t - r.startAt : null,
        charIndexes: r.boundaries.map((b) => b.charIndex),
        durationMs: r.startAt !== null && r.endAt !== null ? r.endAt - r.startAt : null,
      };
      results.boundary.push(row);
      boundaryOut.append(
        h(
          "tr",
          {},
          h("td", {}, v?.name ?? "(lang だけ)"),
          h("td", {}, v?.lang ?? langOf(state.lang).tag),
          h("td", {}, v ? String(v.localService) : ""),
          h("td", { className: r.outcome === "end" ? "" : "warn" }, r.outcome + (r.error ? `(${r.error})` : "")),
          h("td", { className: words + sentences === 0 ? "num warn" : "num" }, words),
          h("td", { className: "num" }, sentences),
          h("td", { className: "num" }, row.firstBoundaryAfterStartMs ?? ""),
          h("td", {}, row.charIndexes.slice(0, 12).join(",") + (row.charIndexes.length > 12 ? ",…" : "")),
        ),
      );
    }
  } finally {
    boundaryRunning = false;
  }
}

const boundarySection = h(
  "section",
  {},
  h("h2", {}, "5. boundary イベント(声ごと)"),
  h(
    "p",
    { className: "note" },
    "選んだ言語のすべての声(と、声を選ばない場合)で短文を1.0倍で順に読み、boundary(word・sentence)が届くかを数える。",
    "boundary が届かない声では、cancel して残りを渡し直すときに、どこまで読んだかが分からない。",
  ),
  h("div", { className: "controls" }, h("button", { textContent: "この言語の全部の声で試す", onclick: () => void boundaryTest() })),
  h(
    "div",
    { className: "table-wrap" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...["声", "lang", "localService", "結果", "word", "sentence", "最初の boundary(start から ms)", "charIndex"].map(
            (s) => h("th", {}, s),
          ),
        ),
      ),
      boundaryOut,
    ),
  ),
);

// ---------------------------------------------------------------------------
// 6. cancel してから渡し直す

const cancelRate = num(1.4, "0.05");
const cancelDelay = h(
  "select",
  {},
  ...[0, 50, 250, 500].map((ms) => h("option", { value: String(ms), textContent: `${ms} ms` })),
);
const cancelOut = h("tbody");
const cancelStatus = h("p");

interface CancelSession {
  first: { utterance: SpeechSynthesisUtterance; done: Promise<SpeakResult> };
  text: string;
  voice: SpeechSynthesisVoice | null;
  lastBoundary: BoundaryRecord | null;
  startAt: number | null;
}
let cancelSession: CancelSession | null = null;

function cancelStart(): void {
  if (!synth) return;
  const text = SAMPLES[state.lang].long;
  const voice = selectedVoice();
  const session: CancelSession = {
    text,
    voice,
    lastBoundary: null,
    startAt: null,
    first: speak({
      text,
      lang: state.lang,
      voice,
      rate: state.rate,
      tag: "cancel:first",
      onBoundary: (b) => {
        session.lastBoundary = b;
        cancelStatus.textContent = `読んでいる位置: ${b.charIndex}(${b.name})`;
      },
    }),
  };
  session.first.utterance.addEventListener("start", () => {
    session.startAt = now();
  });
  cancelSession = session;
  cancelStatus.textContent = "読み始めたら「cancel して渡し直す」を押す";
}

async function cancelAndResume(): Promise<void> {
  const s = cancelSession;
  if (!synth || !s) return;
  cancelSession = null;
  const lang = state.lang;
  const cancelAt = now();
  // boundary が無ければ、経過時間と見積もりから位置を出す
  let index: number;
  let source: string;
  if (s.lastBoundary) {
    index = s.lastBoundary.charIndex;
    source = "boundary";
  } else {
    const elapsedSec = s.startAt === null ? 0 : (cancelAt - s.startAt) / 1000;
    const cps = charsPerSec(lang, s.voice).value;
    // 文字数と添字はほぼ同じとみなす(空白の数のずれは無視する)
    index = snapToWordStart(s.text, elapsedSec * cps * s.first.utterance.rate);
    source = "estimate";
  }
  const rest = remainingText(s.text, index);
  log("cancel", { charIndex: index, source, restChars: countChars(rest, lang) });
  synth.cancel();
  const firstResult = await Promise.race([
    s.first.done,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2000)),
  ]);
  const delay = Number(cancelDelay.value);
  if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
  const rate = Number(cancelRate.value);
  const second = rest
    ? await speak({ text: rest, lang, voice: s.voice, rate, tag: "cancel:resume" }).done
    : null;
  const row = {
    lang,
    voice: voiceInfo(s.voice),
    firstRate: s.first.utterance.rate,
    resumeRate: rate,
    delayMs: delay,
    positionSource: source,
    charIndex: index,
    restChars: countChars(rest, lang),
    firstEvent: firstResult ? firstResult.outcome + (firstResult.error ? `(${firstResult.error})` : "") : "2秒以内にイベントなし",
    firstEventAfterCancelMs: firstResult?.endAt != null ? firstResult.endAt - cancelAt : null,
    resumeOutcome: second ? second.outcome + (second.error ? `(${second.error})` : "") : "残りなし",
    resumeSpeakAfterCancelMs: second ? second.speakAt - cancelAt : null,
    resumeStartAfterSpeakMs: second?.startAt != null ? second.startAt - second.speakAt : null,
  };
  results.cancel.push(row);
  cancelStatus.textContent = "";
  cancelOut.prepend(
    h(
      "tr",
      {},
      h("td", {}, s.voice?.name ?? "(lang だけ)"),
      h("td", { className: "num" }, `${row.firstRate}→${row.resumeRate}`),
      h("td", { className: "num" }, delay),
      h("td", {}, `${source}: ${index}`),
      h("td", {}, row.firstEvent),
      h("td", { className: "num" }, row.firstEventAfterCancelMs ?? ""),
      h("td", { className: second && second.outcome !== "end" ? "warn" : "" }, row.resumeOutcome),
      h("td", { className: "num" }, row.resumeStartAfterSpeakMs ?? ""),
    ),
  );
}

const cancelSection = h(
  "section",
  {},
  h("h2", {}, "6. cancel してから渡し直す"),
  h(
    "p",
    { className: "note" },
    "長めの文を上の速さで読み始め、途中で cancel して、残り(最後の boundary の位置から。boundary が無ければ経過時間から見積もる)を別の速さで渡し直す。",
    "途中から速くするときの手順。cancel した文に end と error(interrupted / canceled)のどちらが来るか、渡し直した文が鳴るか、続きが自然かを聞く。",
  ),
  h(
    "div",
    { className: "controls" },
    h("button", { textContent: "長めの文を読み始める", onclick: cancelStart }),
    h("button", { textContent: "cancel して渡し直す", onclick: () => void cancelAndResume() }),
    h("label", {}, "渡し直す速さ", cancelRate),
    h("label", {}, "cancel から渡し直すまで", cancelDelay),
  ),
  cancelStatus,
  h(
    "div",
    { className: "table-wrap" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...["声", "速さ", "待ち(ms)", "位置", "cancel した文のイベント", "cancel→そのイベント(ms)", "渡し直した文", "speak→start(ms)"].map(
            (s) => h("th", {}, s),
          ),
        ),
      ),
      cancelOut,
    ),
  ),
);

// ---------------------------------------------------------------------------
// 7. ログと書き出し

function exportData(): Record<string, unknown> {
  const { byLanguage, others } = groupVoices(voices);
  return {
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    voices: {
      total: voices.length,
      byLanguage: Object.fromEntries(LANGUAGES.map((l) => [l.code, (byLanguage.get(l.code) ?? []).map(voiceInfo)])),
      missing: LANGUAGES.filter((l) => (byLanguage.get(l.code) ?? []).length === 0).map((l) => l.code),
      others: others.map(voiceInfo),
    },
    calibration: Object.fromEntries(calibration),
    results,
    logs,
  };
}

function download(): void {
  const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `tts-poc-${new Date().toISOString().replaceAll(":", "")}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(exportData(), null, 2));
    log("copied", {});
  } catch (e) {
    log("copy-failed", { error: String(e) });
  }
}

const logSection = h(
  "section",
  {},
  h("h2", {}, "7. ログと書き出し"),
  h(
    "p",
    { className: "note" },
    "書き出す JSON には、ブラウザの情報、声の一覧、上の各表の結果、区切りごとの開始・終了の時刻、ログが入る。",
  ),
  h(
    "div",
    { className: "controls" },
    h("button", { textContent: "JSON を書き出す", onclick: download }),
    h("button", { textContent: "JSON をコピー", onclick: () => void copy() }),
    h("button", {
      textContent: "画面のログを消す(書き出しには残る)",
      onclick: () => logEl.replaceChildren(),
    }),
  ),
  logEl,
);

// ---------------------------------------------------------------------------
// 組み立て

document.querySelector("#app")?.append(
  h("h1", {}, "端末の TTS(speechSynthesis)の PoC"),
  h(
    "p",
    { className: "note" },
    "設計メモの「端末の音声 API で費用を抑える案」を確かめるページ。結果は「7. ログと書き出し」から JSON で持ち帰る。",
  ),
  ...(synth ? [] : [h("p", { className: "warn" }, "このブラウザには speechSynthesis が無い。")]),
  h("p", { className: "note" }, `UA: ${navigator.userAgent}`),
  header,
  permissionSection,
  voicesSection,
  samplesSection,
  queueSection,
  boundarySection,
  cancelSection,
  logSection,
);

renderVoiceSelect();
renderSampleButtons();
renderVoices();

if (synth) {
  synth.addEventListener("voiceschanged", () => loadVoices("voiceschanged"));
  loadVoices("initial");
  // voiceschanged が来ないブラウザのために、しばらく読み直す
  for (const ms of [250, 1000, 3000]) window.setTimeout(() => loadVoices(`poll ${ms}ms`), ms);
  // 操作の前に speak() が鳴るか(Chrome は M71 から無視する)
  window.setTimeout(() => void permissionTest("開いた直後(操作なし)", SAMPLES[state.lang].short), 2000);
}
log("page", { userAgent: navigator.userAgent });
