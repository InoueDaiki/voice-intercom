// プロフィールとルームの取得・更新(TanStack Query)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type Language, type Room } from "@voice-intercom/client-core";

import { api } from "./api.ts";

const keys = {
  me: ["me"] as const,
  rooms: ["rooms"] as const,
  joinable: ["rooms", "joinable"] as const,
  room: (roomId: string) => ["rooms", roomId] as const,
  members: (roomId: string) => ["rooms", roomId, "members"] as const,
  users: ["users"] as const,
};

// 403 / 404 は再試行しても変わらないので、すぐに表示する
function retry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

// 自分のプロフィール。未登録なら null
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.getMyProfile, retry });
}

export function usePutMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ displayName, language }: { displayName: string; language: Language }) =>
      api.putMyProfile(displayName, language),
    onSuccess: (user) => queryClient.setQueryData(keys.me, user),
  });
}

// 自分がメンバーのルーム(アーカイブしたものも)
export function useRooms() {
  return useQuery({ queryKey: [...keys.rooms, "member"], queryFn: api.listRooms, retry });
}

// 自分のテナントの Public のうち、参加していないもの
export function useJoinableRooms(enabled = true) {
  return useQuery({ queryKey: keys.joinable, queryFn: api.listJoinableRooms, retry, enabled });
}

export function useRoom(roomId: string) {
  return useQuery({ queryKey: keys.room(roomId), queryFn: () => api.getRoom(roomId), retry });
}

export function useRoomMembers(roomId: string) {
  return useQuery({ queryKey: keys.members(roomId), queryFn: () => api.listRoomMembers(roomId), retry });
}

// 自分のテナントのユーザー(招待する相手)
export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: api.listUsers, retry });
}

// ルームを変えたら、一覧・ルーム・メンバーを読み直す(ルームの行は返ってきた値で置き換える)
export function useRoomMutation<T>(roomId: string, mutationFn: (value: T) => Promise<Room | void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (room) => {
      if (room) {
        queryClient.setQueryData(keys.room(roomId), room);
      }
      void queryClient.invalidateQueries({ queryKey: keys.rooms });
    },
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, kind, memberIds }: { name: string; kind: "public" | "private"; memberIds: string[] }) =>
      api.createRoom(name, kind, memberIds),
    onSuccess: (room) => {
      queryClient.setQueryData(keys.room(room.room_id), room);
      void queryClient.invalidateQueries({ queryKey: keys.rooms });
    },
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return error.detail === "テナントに所属していない"
        ? "テナントに所属していません。運営者に所属を決めてもらってください。"
        : "このルームに入る権限がありません。";
    }
    if (error.status === 409 && error.detail) {
      return error.detail;
    }
    if (error.status === 404) {
      return "見つかりません。";
    }
    return error.detail ? `${error.message}: ${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
