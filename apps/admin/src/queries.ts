// ルームとユーザーの取得・更新(TanStack Query)。API の呼び出しは adminApi.ts に任せる
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi, ApiError, type Room, type RoomCreate, type RoomUpdate } from "./adminApi.ts";

const keys = {
  rooms: ["rooms"] as const,
  room: (roomId: string) => ["rooms", roomId] as const,
  timeline: (roomId: string) => ["rooms", roomId, "timeline"] as const,
  users: ["users"] as const,
};

// 履歴の1ページの件数
const TIMELINE_PAGE_SIZE = 50;

// 403 / 404 は再試行しても変わらないので、すぐに表示する
function retry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

export function useRooms() {
  return useQuery({
    queryKey: keys.rooms,
    queryFn: async () => (await adminApi.listRooms()).items,
    retry,
  });
}

export function useRoom(roomId: string) {
  return useQuery({ queryKey: keys.room(roomId), queryFn: () => adminApi.getRoom(roomId), retry });
}

export function useUsers() {
  return useQuery({
    queryKey: keys.users,
    queryFn: async () => (await adminApi.listUsers()).items,
    retry,
  });
}

// ルームの履歴(新しい順)。fetchNextPage で、最後のページの next_before より古いものを読む
export function useTimeline(roomId: string) {
  return useInfiniteQuery({
    queryKey: keys.timeline(roomId),
    queryFn: ({ pageParam }) => adminApi.listTimeline(roomId, { limit: TIMELINE_PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before ?? undefined,
    retry,
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RoomCreate) => adminApi.createRoom(body),
    onSuccess: (room) => {
      queryClient.setQueryData(keys.room(room.room_id), room);
      void queryClient.invalidateQueries({ queryKey: keys.rooms, exact: true });
    },
  });
}

export function useUpdateRoom(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RoomUpdate) => adminApi.updateRoom(roomId, body),
    onSuccess: (room: Room) => {
      queryClient.setQueryData(keys.room(roomId), room);
      void queryClient.invalidateQueries({ queryKey: keys.rooms, exact: true });
    },
  });
}

export function useDeleteRoom(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.deleteRoom(roomId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.room(roomId) });
      void queryClient.invalidateQueries({ queryKey: keys.rooms, exact: true });
    },
  });
}
