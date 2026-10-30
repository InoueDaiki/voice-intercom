// 送る画像・動画・ファイルを選ぶ
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

import type { PickedMedia } from "../mobileMedia.ts";

async function pickFromLibrary(): Promise<PickedMedia[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    // 画像は元のまま。動画は iOS が互換の形式(H.264)に変換して渡す
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) {
    return [];
  }
  return result.assets.map((a) => ({
    uri: a.uri,
    name: a.fileName ?? a.uri.split("/").pop() ?? "media",
    mimeType: a.mimeType,
    durationMs: a.duration ?? undefined,
    width: a.width,
    height: a.height,
  }));
}

async function pickDocuments(): Promise<PickedMedia[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) {
    return [];
  }
  return result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType }));
}

// どこから選ぶかを聞く。選んだものを onPicked に渡す
export function askMedia(onPicked: (media: PickedMedia[]) => void): void {
  const run = (pick: () => Promise<PickedMedia[]>) => {
    pick()
      .then(onPicked)
      .catch((e: unknown) => {
        console.warn("選べなかった", e);
        Alert.alert("選べませんでした", e instanceof Error ? e.message : String(e));
      });
  };
  Alert.alert("送るものを選ぶ", "10GB まで送れます", [
    { text: "写真・動画", onPress: () => run(pickFromLibrary) },
    { text: "ファイル", onPress: () => run(pickDocuments) },
    { text: "やめる", style: "cancel" },
  ]);
}
