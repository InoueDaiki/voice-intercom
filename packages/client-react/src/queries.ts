// プロフィールとルームの取得・更新(TanStack Query)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Language, Room } from "@voice-intercom/client-core";

import { useApi } from "./api.tsx";
import { retry } from "./errors.ts";

const keys = {
  me: ["me"] as const,
  rooms: ["rooms"] as const,
  joinable: ["rooms", "joinable"] as const,
  room: (roomId: string) => ["rooms", roomId] as const,
  members: (roomId: string) => ["rooms", roomId, "members"] as const,
  users: ["users"] as const,
};

// 自分のプロフィール。未登録なら null
export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: keys.me, queryFn: api.getMyProfile, retry });
}

export function usePutMe() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ displayName, language }: { displayName: string; language: Language }) =>
      api.putMyProfile(displayName, language),
    onSuccess: (user) => queryClient.setQueryData(keys.me, user),
  });
}

// 自分がメンバーのルーム(アーカイブしたものも)
export function useRooms() {
  const api = useApi();
  return useQuery({ queryKey: [...keys.rooms, "member"], queryFn: api.listRooms, retry });
}

// 自分のテナントの Public のうち、参加していないもの
export function useJoinableRooms(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: keys.joinable, queryFn: api.listJoinableRooms, retry, enabled });
}

export function useRoom(roomId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.room(roomId), queryFn: () => api.getRoom(roomId), retry });
}

export function useRoomMembers(roomId: string) {
  const api = useApi();
  return useQuery({ queryKey: keys.members(roomId), queryFn: () => api.listRoomMembers(roomId), retry });
}

// 自分のテナントのユーザー(招待する相手)
export function useUsers() {
  const api = useApi();
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
  const api = useApi();
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
