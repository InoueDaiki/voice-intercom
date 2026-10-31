// 送る画像・動画・ファイルを選ぶ。カメラで撮ることもできる
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { PickedMedia } from "../mobileMedia.ts";
import { whileSystemUiOpen } from "../roomPlatform.ts";

// Android のピッカーは元の名前を渡さず、番号や UUID の名前になる。読める名前に置き換える
function displayName(asset: ImagePicker.ImagePickerAsset): string {
  const name = asset.fileName ?? asset.uri.split("/").pop() ?? "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const stem = name.slice(0, name.length - ext.length);
  if (stem !== "" && !/^(?:\d+|[0-9a-f-]{32,36}|rn_image_picker.*)$/i.test(stem)) {
    return name;
  }
  const t = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${t.getFullYear()}${two(t.getMonth() + 1)}${two(t.getDate())}_${two(t.getHours())}${two(t.getMinutes())}${two(t.getSeconds())}`;
  return `${asset.type === "video" ? "VID" : "IMG"}_${stamp}${ext}`;
}

function toPicked(result: ImagePicker.ImagePickerResult): PickedMedia[] {
  if (result.canceled) {
    return [];
  }
  return result.assets.map((a) => ({
    uri: a.uri,
    name: displayName(a),
    mimeType: a.mimeType,
    durationMs: a.duration ?? undefined,
    width: a.width,
    height: a.height,
  }));
}

export function pickFromLibrary(): Promise<PickedMedia[]> {
  return whileSystemUiOpen(async () =>
    toPicked(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        // 画像は元のまま。動画は iOS が互換の形式(H.264)に変換して渡す
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      }),
    ),
  );
}

// Android は1回の呼び出しで写真か動画のどちらかしか撮れない(両方を渡すと写真になる)ので、撮るものを分ける
export function pickFromCamera(mediaType: "images" | "videos"): Promise<PickedMedia[]> {
  return whileSystemUiOpen(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error("カメラの使用が許可されていません。端末の設定から許可してください。");
    }
    return toPicked(await ImagePicker.launchCameraAsync({ mediaTypes: [mediaType], quality: 1 }));
  });
}

export function pickDocuments(): Promise<PickedMedia[]> {
  return whileSystemUiOpen(async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) {
      return [];
    }
    return result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType }));
  });
}
