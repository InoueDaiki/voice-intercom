// spike の画面。入室、Push to Talk のチャンネルへの参加、押して話す、push の宛先(トークン)、
// push からの経過時間、出来事の記録を出す。PoC なのでデザインシステムは使わない

import { type ReactNode, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { appLog, MILESTONES } from "./src/log";
import { controller } from "./src/pttController";
import { bundleId, devHost } from "./src/settings";

controller.start();

function useVersion(o: { subscribe: (l: () => void) => () => void; getVersion: () => number }): number {
  return useSyncExternalStore(o.subscribe, o.getVersion);
}

export default function App() {
  useVersion(controller);
  useVersion(appLog);
  const c = controller;
  const session = c.session;
  const [username, setUsername] = useState(c.settings?.username ?? "user1");
  const [roomId, setRoomId] = useState(c.settings?.roomId ?? "");
  const since = appLog.sinceLastPush;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>PTT PoC</Text>
        <Text style={styles.small}>
          DEV_HOST: {devHost} / Push to Talk: {c.pttSupported ? "あり" : "なし(モジュールが無い)"}
        </Text>
        {c.error && <Text style={styles.error}>{c.error}</Text>}

        <Section title="1. 入室">
          <Field label="username" value={username} onChange={setUsername} placeholder={c.settings?.username} />
          <Field label="room_id" value={roomId} onChange={setRoomId} placeholder={c.settings?.roomId} />
          <Row>
            <Button
              label="入室"
              disabled={c.busy}
              onPress={() =>
                void c.enter({
                  ...c.settings,
                  username: username || (c.settings?.username ?? ""),
                  roomId: roomId || (c.settings?.roomId ?? ""),
                })
              }
            />
            <Button label="退室" disabled={!session} onPress={() => void c.leaveRoom()} />
          </Row>
          <Text style={styles.small}>
            {session
              ? `${session.roomName}: ${session.connected ? "接続中" : session.joining ? "入室中" : "切断"} / 参加者 ${session.participantCount} / Agent ${session.agentPresent ? "あり" : "なし"}`
              : "未入室"}
          </Text>
          {session?.error && <Text style={styles.error}>{session.error}</Text>}
          {session?.warning && <Text style={styles.small}>{session.warning}</Text>}
        </Section>

        <Section title="2. Push to Talk のチャンネル">
          <Row>
            <Button label="参加" disabled={!c.pttSupported || c.busy || !c.settings} onPress={() => void c.joinChannel()} />
            <Button label="出る" disabled={!c.activeChannelId} onPress={() => void c.leaveChannel()} />
          </Row>
          <Row>
            <Button label="半二重" disabled={!c.activeChannelId} onPress={() => void c.setTransmissionMode("halfDuplex")} />
            <Button label="全二重" disabled={!c.activeChannelId} onPress={() => void c.setTransmissionMode("fullDuplex")} />
          </Row>
          <Text style={styles.small}>チャンネル: {c.activeChannelId ?? "なし"}</Text>
          <Text style={styles.small}>
            音声セッション: {c.audioActive ? "有効" : "無効"} / 話している人: {c.remoteSpeaker ?? "なし"}
          </Text>
        </Section>

        <Section title="3. 話す">
          <Pressable
            style={[styles.talk, (c.transmitting || session?.talking) && styles.talkOn]}
            onPressIn={() => c.pressTalk(true)}
            onPressOut={() => c.pressTalk(false)}
          >
            <Text style={styles.talkLabel}>{session?.talking ? "送信中" : "押して話す"}</Text>
          </Pressable>
          <Text style={styles.small}>
            送信(システム): {c.transmitting ? "中" : "なし"} / マイク: {session?.talking ? "on" : "off"}
          </Text>
        </Section>

        <Section title="4. push の宛先">
          <Text style={styles.mono} selectable>
            {c.pushToken ?? "(チャンネルに参加すると届く)"}
          </Text>
          <Text style={styles.small} selectable>
            topic: {bundleId}.voip-ptt
          </Text>
          <Button label="トークンを共有" disabled={!c.pushToken} onPress={() => void Share.share({ message: c.pushToken ?? "" })} />
        </Section>

        <Section title="5. 最後の push からの経過(ミリ秒)">
          {since ? (
            MILESTONES.map((m) => (
              <Text key={m} style={styles.mono}>
                {m.padEnd(22)} {since.elapsed[m] ?? "-"}
              </Text>
            ))
          ) : (
            <Text style={styles.small}>まだ push が届いていない</Text>
          )}
        </Section>

        <Section title="6. 出来事">
          <Button label="記録を共有(JSON)" onPress={() => void Share.share({ message: appLog.toJson() })} />
          {appLog.entries
            .slice(-80)
            .reverse()
            .map((e, i) => (
              <Text key={`${e.atMs}-${i}`} style={styles.mono}>
                {new Date(e.atMs).toISOString().slice(11, 23)} {e.source === "native" ? "N" : "J"} {e.type}
                {e.detail ? ` ${e.detail}` : ""}
              </Text>
            ))}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Button(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.button, props.disabled && styles.disabled]} onPress={props.onPress} disabled={props.disabled}>
      <Text style={styles.buttonLabel}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // PoC なので、安全な領域は固定の余白で避ける
  root: { flex: 1, backgroundColor: "#fff", paddingTop: 48 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: "700" },
  section: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#ccc", paddingTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { width: 80 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  button: { backgroundColor: "#2563eb", borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14 },
  buttonLabel: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  talk: { height: 120, borderRadius: 12, backgroundColor: "#e5e7eb", alignItems: "center", justifyContent: "center" },
  talkOn: { backgroundColor: "#f87171" },
  talkLabel: { fontSize: 20, fontWeight: "700" },
  small: { fontSize: 12, color: "#555" },
  error: { color: "#b91c1c" },
  mono: { fontFamily: "Menlo", fontSize: 11 },
});
