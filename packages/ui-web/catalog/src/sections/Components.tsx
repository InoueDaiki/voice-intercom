import { ChevronLeft, Languages, Mic, Plus, RefreshCw, Settings, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  ConfirmDialog,
  Field,
  FullScreenMessage,
  Input,
  PageHeader,
  PttButton,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  type ConfirmDialogTone,
  type PttState,
} from "@voice-intercom/ui-web";

import { Example, PropsTable, Section } from "../Example.tsx";

const iconClass = "size-4";

export function ButtonSection() {
  return (
    <Section id="button" title="Button" description="操作。primary は画面の主な操作で、1画面に1つだけ置く。">
      <Example
        title="variant"
        code={`<Button variant="primary">参加する</Button>
<Button>キャンセル</Button>
<Button variant="ghost">設定</Button>
<Button variant="danger">削除する</Button>
<Button variant="link">詳しく</Button>`}
      >
        <Button variant="primary">参加する</Button>
        <Button>キャンセル</Button>
        <Button variant="ghost">設定</Button>
        <Button variant="danger">削除する</Button>
        <Button variant="link">詳しく</Button>
      </Example>
      <Example title="size" code={`<Button size="sm">…</Button>  // h-8\n<Button size="md">…</Button>  // h-10(既定)\n<Button size="lg">…</Button>  // h-12`}>
        <Button variant="primary" size="sm">
          小 sm
        </Button>
        <Button variant="primary" size="md">
          中 md
        </Button>
        <Button variant="primary" size="lg">
          大 lg
        </Button>
        <Button size="sm">小 sm</Button>
        <Button size="md">中 md</Button>
        <Button size="lg">大 lg</Button>
      </Example>
      <Example
        title="アイコン付き・アイコンだけ(Lucide)"
        code={`<Button variant="primary"><Plus className="size-4" aria-hidden />ルームを作る</Button>
<Button variant="ghost" icon aria-label="設定"><Settings className="size-4" aria-hidden /></Button>`}
      >
        <Button variant="primary">
          <Plus className={iconClass} aria-hidden />
          ルームを作る
        </Button>
        <Button>
          <RefreshCw className={iconClass} aria-hidden />
          再読み込み
        </Button>
        <Button variant="danger">
          <Trash2 className={iconClass} aria-hidden />
          削除する
        </Button>
        <Button variant="ghost" icon aria-label="設定">
          <Settings className={iconClass} aria-hidden />
        </Button>
        <Button icon aria-label="再読み込み">
          <RefreshCw className={iconClass} aria-hidden />
        </Button>
      </Example>
      <Example title="disabled" code={`<Button variant="primary" disabled>参加する</Button>`}>
        <Button variant="primary" disabled>
          参加する
        </Button>
        <Button disabled>キャンセル</Button>
        <Button variant="ghost" disabled>
          設定
        </Button>
        <Button variant="danger" disabled>
          削除する
        </Button>
        <Button variant="link" disabled>
          詳しく
        </Button>
      </Example>
      <Example
        title="リンクをボタンの見た目にする(buttonClass)"
        code={`<Link to="/rooms/new" className={buttonClass({ variant: "primary" })}>ルームを作る</Link>`}
      >
        <a href="#button" className={buttonClass({ variant: "primary" })}>
          ルームを作る
        </a>
        <a href="#button" className={buttonClass({ size: "sm" })}>
          一覧へ
        </a>
      </Example>
      <PropsTable
        rows={[
          { name: "variant", type: '"primary" | "secondary" | "ghost" | "danger" | "link"', defaultValue: '"secondary"', description: "見た目と役割" },
          { name: "size", type: '"sm" | "md" | "lg"', defaultValue: '"md"', description: "高さと文字の大きさ。link では効かない" },
          { name: "icon", type: "boolean", defaultValue: "false", description: "アイコンだけの正方形のボタン。名前は aria-label で付ける" },
          { name: "type", type: "button の type", defaultValue: '"button"', description: "フォームの送信は type=\"submit\" を渡す" },
          { name: "…", type: 'ComponentProps<"button">', description: "そのほかは <button> に渡る" },
        ]}
      />
    </Section>
  );
}

export function FieldSection() {
  return (
    <Section
      id="field"
      title="Field・Input・Textarea・Select"
      description="ラベル・説明・誤りと入力欄1つの組。id と aria-describedby・aria-invalid は Field が付ける。"
    >
      <Example
        previewClassName="grid gap-5 sm:grid-cols-2 items-start"
        code={`<Field label="ルーム名" hint="40文字まで">
  <Input defaultValue="倉庫A" />
</Field>
<Field label="表示名" error="表示名を入れてください">
  <Input />
</Field>`}
      >
        <Field label="ルーム名" hint="40文字まで">
          <Input defaultValue="倉庫A" maxLength={40} />
        </Field>
        <Field label="表示名" error="表示名を入れてください">
          <Input placeholder="山田 太郎" />
        </Field>
        <Field label="話す言語" hint="字幕と翻訳に使う">
          <Select defaultValue="ja">
            <option value="ja">日本語</option>
            <option value="en">英語</option>
            <option value="vi">ベトナム語</option>
          </Select>
        </Field>
        <Field label="ルームID" hint="作った後は変えられない">
          <Input defaultValue="warehouse-a" disabled />
        </Field>
        <Field label="説明" className="sm:col-span-2">
          <Textarea rows={3} defaultValue="1階の倉庫で使う。朝の点呼もここで行う。" />
        </Field>
      </Example>
      <PropsTable
        rows={[
          { name: "label", type: "ReactNode", description: "ラベル(必須)" },
          { name: "hint", type: "ReactNode", description: "入力の説明(文字数、書き方)" },
          { name: "error", type: "ReactNode", description: "誤り。あると入力欄を誤りの見た目にし、読み上げで説明として読ませる" },
          { name: "children", type: "ReactNode", description: "Input・Textarea・Select を1つ" },
        ]}
      />
    </Section>
  );
}

export function BadgeSection() {
  return (
    <Section id="badge" title="Badge" description="短い状態の札。live は送話中(TX)、rx は受信中にだけ使う。">
      <Example
        code={`<Badge>3人</Badge>
<Badge tone="primary">翻訳あり</Badge>
<Badge tone="live">TX</Badge>
<Badge tone="rx">RX</Badge>`}
      >
        <Badge>
          <Users className="size-3" aria-hidden />
          3人
        </Badge>
        <Badge tone="primary">
          <Languages className="size-3" aria-hidden />
          翻訳あり
        </Badge>
        <Badge tone="success">ok</Badge>
        <Badge tone="warning">モック API</Badge>
        <Badge tone="danger">接続できません</Badge>
        <Badge tone="live">
          <Mic className="size-3" aria-hidden />
          TX
        </Badge>
        <Badge tone="rx">RX</Badge>
      </Example>
      <PropsTable
        rows={[
          {
            name: "tone",
            type: '"neutral" | "primary" | "success" | "warning" | "danger" | "live" | "rx"',
            defaultValue: '"neutral"',
            description: "色と意味",
          },
        ]}
      />
    </Section>
  );
}

export function AlertSection() {
  return (
    <Section id="alert" title="Alert" description={`画面の中の知らせ。danger は既定で role="alert" になる。`}>
      <Example
        previewClassName="grid gap-3"
        code={`<Alert tone="danger" action={<Button size="sm">再読み込み</Button>}>
  ルーム一覧を取得できません。
</Alert>`}
      >
        <Alert>モック API につないでいます。データは保存されません。</Alert>
        <Alert tone="success">保存しました。</Alert>
        <Alert tone="warning">音が止められています。画面を一度押すと聞こえるようになります。</Alert>
        <Alert tone="danger">削除できません: 権限がありません</Alert>
        <Alert
          tone="danger"
          action={
            <Button size="sm">
              <RefreshCw className={iconClass} aria-hidden />
              再読み込み
            </Button>
          }
        >
          ルーム一覧を取得できません。
        </Alert>
      </Example>
      <PropsTable
        rows={[
          { name: "tone", type: '"info" | "success" | "warning" | "danger"', defaultValue: '"info"', description: "色と意味" },
          { name: "action", type: "ReactNode", description: "右に並べる操作(再読み込みなど)" },
        ]}
      />
    </Section>
  );
}

export function CardSection() {
  return (
    <Section id="card" title="Card" description="地の上に置く面。中の余白は既定で p-4。">
      <Example
        previewClassName="grid gap-4 sm:grid-cols-2 items-start"
        code={`<Card>…</Card>
<Card tone="danger">…</Card>`}
      >
        <Card className="grid gap-2">
          <h2>倉庫A</h2>
          <p className="text-sm text-fg-muted">メンバー 5人・最後の発話 12:05</p>
        </Card>
        <Card tone="danger" className="grid gap-3">
          <h2>ルームを削除する</h2>
          <p className="text-sm text-fg-muted">全員を切断し、履歴とメディアも消します。元に戻せません。</p>
          <Button variant="danger" className="justify-self-start">
            削除する
          </Button>
        </Card>
      </Example>
      <PropsTable rows={[{ name: "tone", type: '"default" | "danger"', defaultValue: '"default"', description: "danger は削除などの操作をまとめる面" }]} />
    </Section>
  );
}

const members = [
  { name: "山田 太郎", role: "管理者", lang: "日本語", talks: 128 },
  { name: "Nguyen Van A", role: "メンバー", lang: "ベトナム語", talks: 42 },
  { name: "John Smith", role: "メンバー", lang: "英語", talks: 7 },
];

export function ConfirmDialogSection() {
  const [open, setOpen] = useState<ConfirmDialogTone>();
  const [result, setResult] = useState("まだ開いていません");
  const close = (tone: ConfirmDialogTone, answer: string) => {
    setOpen(undefined);
    setResult(`${tone}: ${answer}`);
  };
  return (
    <Section
      id="confirm-dialog"
      title="ConfirmDialog"
      description="確定か取りやめかを選ばせるダイアログ(window.confirm の代わり)。Radix の AlertDialog を下敷きにする。"
    >
      <Example
        title="tone(ボタンで開く)"
        code={`const [open, setOpen] = useState(false);

<Button variant="danger" onClick={() => setOpen(true)}>このルームを削除</Button>
<ConfirmDialog
  open={open}
  tone="danger"
  title="ルーム「倉庫A」を削除しますか?"
  description="今ルームにいる人は切られ、履歴とメディアも消えます。元に戻せません。"
  confirmLabel="削除する"
  onConfirm={() => { setOpen(false); remove(); }}
  onCancel={() => setOpen(false)}
/>`}
      >
        <Button onClick={() => setOpen("default")}>ふつうの確かめ</Button>
        <Button variant="danger" onClick={() => setOpen("danger")}>
          <Trash2 className={iconClass} aria-hidden />
          このルームを削除
        </Button>
        <p className="text-sm text-fg-muted" aria-live="polite">
          結果: {result}
        </p>
        <ConfirmDialog
          open={open === "default"}
          title="ルームを出ますか?"
          description="出ている間の発言は、入り直すとタイムラインで読めます。"
          confirmLabel="出る"
          onConfirm={() => close("default", "確定")}
          onCancel={() => close("default", "取りやめ")}
        />
        <ConfirmDialog
          open={open === "danger"}
          tone="danger"
          title="ルーム「倉庫A」を削除しますか?"
          description="ID: warehouse-a。今ルームにいる人は切られ、話した履歴と送った画像・動画も消えます。元に戻せません。"
          confirmLabel="削除する"
          onConfirm={() => close("danger", "確定")}
          onCancel={() => close("danger", "取りやめ")}
        />
      </Example>
      <ul className="grid list-disc gap-1 pl-5 text-sm text-fg-muted">
        <li>開くと取りやめのボタンにフォーカスが置かれる。Enter をうっかり押しても、危ない操作は確定しない。</li>
        <li>Tab と Shift+Tab はダイアログの中だけを回る。Esc で取りやめる。後ろの幕を押しても閉じない。</li>
        <li>閉じると、開く前にフォーカスのあったボタンに戻る。</li>
        <li>幅の狭い画面では、ボタンを縦に並べ、確定を上に置く。</li>
      </ul>
      <PropsTable
        rows={[
          { name: "open", type: "boolean", description: "開いているか。開け閉めは呼び出し側が持つ" },
          { name: "title", type: "string", description: "問い(「〜を削除しますか?」)" },
          { name: "description", type: "ReactNode", description: "何が起きるか、元に戻せるか。文字列で書く(ui-native でも描ける)" },
          { name: "confirmLabel", type: "string", description: "確定のボタンの文言。「はい」ではなく動詞で書く(「削除する」)" },
          { name: "cancelLabel", type: "string", defaultValue: '"やめる"', description: "取りやめのボタンの文言" },
          {
            name: "tone",
            type: '"default" | "danger"',
            defaultValue: '"default"',
            description: "danger は取り返しのつかない操作。題に赤の表示灯を点け、確定を danger のボタンにする",
          },
          { name: "onConfirm", type: "() => void", description: "確定。呼び出し側で open を false にしてから処理を始める" },
          { name: "onCancel", type: "() => void", description: "取りやめ(ボタン、Esc)。呼び出し側で open を false にする" },
        ]}
      />
    </Section>
  );
}

export function TableSection() {
  return (
    <Section id="table" title="Table・Th・Td" description={`表。数値の列は align="end"、操作の列は shrink。幅が足りなければ横に流す。`}>
      <Example
        previewClassName="block"
        code={`<Table>
  <thead><tr><Th>名前</Th><Th align="end">発話</Th><Th shrink /></tr></thead>
  <tbody><tr><Td>山田 太郎</Td><Td align="end">128</Td><Td shrink>…</Td></tr></tbody>
</Table>`}
      >
        <Table>
          <thead>
            <tr>
              <Th>名前</Th>
              <Th>役割</Th>
              <Th>言語</Th>
              <Th align="end">発話</Th>
              <Th shrink>
                <span className="sr-only">操作</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.name}>
                <Td>{m.name}</Td>
                <Td>
                  <Badge tone={m.role === "管理者" ? "primary" : "neutral"}>{m.role}</Badge>
                </Td>
                <Td>{m.lang}</Td>
                <Td align="end">{m.talks}</Td>
                <Td shrink>
                  <Button variant="link">外す</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Example>
      <PropsTable
        rows={[
          { name: "align", type: '"start" | "end"', defaultValue: '"start"', description: "Th・Td。end は数値(右寄せ、桁をそろえる)" },
          { name: "shrink", type: "boolean", defaultValue: "false", description: "Th・Td。中身の幅だけにする(操作の列)" },
        ]}
      />
    </Section>
  );
}

export function PageHeaderSection() {
  return (
    <Section id="page-header" title="PageHeader" description="画面の題。各画面の最初に置く。">
      <Example
        previewClassName="block"
        code={`<PageHeader
  back={<Link to="/rooms">ルーム一覧</Link>}
  title="倉庫A"
  description="1階の倉庫で使う"
  actions={<Button variant="primary">参加する</Button>}
/>`}
      >
        <PageHeader
          back={
            <a href="#page-header" className="inline-flex items-center gap-1">
              <ChevronLeft className={iconClass} aria-hidden />
              ルーム一覧
            </a>
          }
          title="倉庫A"
          description="1階の倉庫で使う。朝の点呼もここで行う。"
          actions={
            <>
              <Button>編集</Button>
              <Button variant="primary">参加する</Button>
            </>
          }
        />
      </Example>
      <PropsTable
        rows={[
          { name: "title", type: "ReactNode", description: "題(h1)" },
          { name: "description", type: "ReactNode", description: "題の下の説明" },
          { name: "back", type: "ReactNode", description: "題の上に置く戻るリンク" },
          { name: "actions", type: "ReactNode", description: "右に並べる操作" },
        ]}
      />
    </Section>
  );
}

type FullScreenDemo = "loading" | "error" | null;

export function FullScreenMessageSection() {
  const [demo, setDemo] = useState<FullScreenDemo>(null);

  useEffect(() => {
    if (!demo) {
      return;
    }
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDemo(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [demo]);

  return (
    <Section
      id="full-screen-message"
      title="FullScreenMessage"
      description="画面全体の真ん中に出す知らせ(読み込み中、ログインの失敗、権限がない)。画面全体を使うので、ボタンで開いて見る(Esc で閉じる)。"
    >
      <Example
        code={`<FullScreenMessage>読み込み中…</FullScreenMessage>
<FullScreenMessage action={<Button variant="primary">もう一度ログイン</Button>}>
  ログインできませんでした。
</FullScreenMessage>`}
      >
        <Button onClick={() => setDemo("loading")}>読み込み中を開く</Button>
        <Button onClick={() => setDemo("error")}>ログインの失敗を開く</Button>
      </Example>
      <PropsTable
        rows={[
          { name: "children", type: "ReactNode", description: "知らせの文" },
          { name: "action", type: "ReactNode", description: "下に置く操作" },
        ]}
      />
      {demo && (
        <div role="dialog" aria-modal="true" aria-label="FullScreenMessage の見本" className="fixed inset-0 z-50 bg-canvas">
          <FullScreenMessage
            action={
              <div className="flex gap-2">
                {demo === "error" && <Button variant="primary">もう一度ログイン</Button>}
                <Button variant="ghost" onClick={() => setDemo(null)} autoFocus>
                  見本を閉じる
                </Button>
              </div>
            }
          >
            {demo === "loading" ? "読み込み中…" : "ログインできませんでした。"}
          </FullScreenMessage>
        </div>
      )}
    </Section>
  );
}

const pttLabels: Record<PttState, string> = {
  idle: "押して話す",
  pressing: "マイクを準備中…",
  talking: "送話中",
};

// 押してからマイクの準備ができるまでの間(見本の作りもの)
const PREPARE_MS = 600;

function PttDemo() {
  const [state, setState] = useState<PttState>("idle");
  const timer = useRef<number | undefined>(undefined);

  const press = () => {
    if (state !== "idle") {
      return;
    }
    setState("pressing");
    timer.current = window.setTimeout(() => setState("talking"), PREPARE_MS);
  };
  const release = () => {
    window.clearTimeout(timer.current);
    setState("idle");
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key !== " " || e.repeat) {
      return;
    }
    e.preventDefault();
    if (down) {
      press();
    } else {
      release();
    }
  };

  return (
    <PttButton
      className="w-full max-w-md"
      state={state}
      shortcut="Space"
      aria-pressed={state !== "idle"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKey(true)}
      onKeyUp={onKey(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {pttLabels[state]}
    </PttButton>
  );
}

export function PttButtonSection() {
  return (
    <Section
      id="ptt-button"
      title="PttButton"
      description="PTT(押している間だけ話す)のキー。押していなければ消灯したキー、押したら琥珀に灯り、声を送れたら赤(TX)。押す・離すの処理は呼び出し側で付ける。"
    >
      <Example title="試す(押している間、または Space を押している間)" previewClassName="flex justify-center py-10">
        <PttDemo />
      </Example>
      <Example
        title="state"
        previewClassName="grid gap-3 justify-items-center"
        code={`<PttButton state="idle" shortcut="Space">押して話す</PttButton>
<PttButton state="pressing">マイクを準備中…</PttButton>
<PttButton state="talking">送話中</PttButton>`}
      >
        {(["idle", "pressing", "talking"] as const).map((state) => (
          <div key={state} className="grid w-full justify-items-center gap-1.5">
            <PttButton className="w-full max-w-80" state={state} shortcut="Space" tabIndex={-1}>
              {pttLabels[state]}
            </PttButton>
            <code className="text-xs">{state}</code>
          </div>
        ))}
        <div className="grid w-full justify-items-center gap-1.5">
          <PttButton className="w-full max-w-80" state="idle" disabled>
            {pttLabels.idle}
          </PttButton>
          <code className="text-xs">disabled</code>
        </div>
      </Example>
      <PropsTable
        rows={[
          { name: "state", type: '"idle" | "pressing" | "talking"', description: "押していない・マイクの準備中・送話中(必須)" },
          { name: "shortcut", type: "ReactNode", description: "右の端に添えるキーボードの操作。幅の狭い画面では出さない" },
          { name: "…", type: 'ComponentProps<"button">', description: "onPointerDown などの処理は呼び出し側で付ける" },
        ]}
      />
    </Section>
  );
}
