// 入力の検証。上限は services/api のモデルと同じにする

// PutUserRequest の display_name
export const DISPLAY_NAME_MAX = 50;
// RoomName
export const ROOM_NAME_MAX = 100;

// 表示名の誤り。前後の空白を除いてから渡す。問題なければ undefined
export function displayNameError(trimmed: string): string | undefined {
  if (trimmed === "") {
    return "表示名を入力してください";
  }
  return [...trimmed].length > DISPLAY_NAME_MAX ? `表示名は${DISPLAY_NAME_MAX}文字以内にしてください` : undefined;
}

// ルームの名前の誤り。前後の空白を除いてから渡す。問題なければ undefined
export function roomNameError(trimmed: string): string | undefined {
  if (trimmed === "") {
    return "名前を入力してください";
  }
  return [...trimmed].length > ROOM_NAME_MAX ? `名前は${ROOM_NAME_MAX}文字以内にしてください` : undefined;
}
