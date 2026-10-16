// プロフィールとルームの取得・更新(TanStack Query)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type Language } from "@voice-intercom/client-core";

import { api } from "./api.ts";

const keys = {
  me: ["me"] as const,
  rooms: ["rooms"] as const,
  room: (roomId: string) => ["rooms", roomId] as const,
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

export function useRooms() {
  return useQuery({ queryKey: keys.rooms, queryFn: api.listRooms, retry });
}

export function useRoom(roomId: string) {
  return useQuery({ queryKey: keys.room(roomId), queryFn: () => api.getRoom(roomId), retry });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return "このルームに入る権限がありません。";
    }
    if (error.status === 404) {
      return "見つかりません。";
    }
    return error.detail ? `${error.message}: ${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
