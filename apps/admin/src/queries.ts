// ルーム・ユーザー・テナント・Connect の申請の取得・更新(TanStack Query)。API の呼び出しは adminApi.ts に任せる
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adminApi, ApiError, type Room } from "./adminApi.ts";

const keys = {
  rooms: ["rooms"] as const,
  room: (roomId: string) => ["rooms", roomId] as const,
  members: (roomId: string) => ["rooms", roomId, "members"] as const,
  users: ["users"] as const,
  tenants: ["tenants"] as const,
  connectRequests: ["connect-requests"] as const,
};

// 403 / 404 は再試行しても変わらないので、すぐに表示する
function retry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

// 自分のプロフィール。管理者のテナント(変えられるメンバーの範囲)を知るのに使う
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: adminApi.getMe, retry });
}

// enabled が false なら読まない(運営者は使えない)
export function useRooms(enabled = true) {
  return useQuery({ queryKey: keys.rooms, queryFn: async () => (await adminApi.listRooms()).items, retry, enabled });
}

export function useRoom(roomId: string) {
  return useQuery({ queryKey: keys.room(roomId), queryFn: () => adminApi.getRoom(roomId), retry });
}

export function useRoomMembers(roomId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: keys.members(roomId),
    queryFn: async () => {
      try {
        return (await adminApi.listRoomMembers(roomId)).items;
      } catch (e) {
        // 持っているルームが古い(ほかの管理者が削除を始めた)ことがある。読み直して削除の案内に変える
        if (e instanceof ApiError && e.status === 404) {
          void queryClient.invalidateQueries({ queryKey: keys.room(roomId), exact: true });
        }
        throw e;
      }
    },
    retry,
  });
}

export function useUsers() {
  return useQuery({ queryKey: keys.users, queryFn: async () => (await adminApi.listUsers()).items, retry });
}

// enabled が false なら読まない(運営者だけが使える)
export function useTenants(enabled = true) {
  return useQuery({ queryKey: keys.tenants, queryFn: async () => (await adminApi.listTenants()).items, retry, enabled });
}

export function useConnectRequests() {
  return useQuery({
    queryKey: keys.connectRequests,
    queryFn: async () => (await adminApi.listConnectRequests()).items,
    retry,
  });
}

// ルームを変える操作。返ってきたルームで置き換え、一覧・メンバー・申請を読み直す
export function useRoomMutation<T>(roomId: string, mutationFn: (value: T) => Promise<Room | void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (room) => {
      if (room) {
        queryClient.setQueryData(keys.room(roomId), room);
      }
      void queryClient.invalidateQueries({ queryKey: keys.rooms });
      void queryClient.invalidateQueries({ queryKey: keys.connectRequests });
    },
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createRoom,
    onSuccess: (room) => {
      queryClient.setQueryData(keys.room(room.room_id), room);
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
    // 503 などで止まっても、deleting_at が付いていることがある。読み直して削除の途中の表示に変える
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: keys.room(roomId), exact: true });
      void queryClient.invalidateQueries({ queryKey: keys.rooms, exact: true });
    },
  });
}

// Connect の申請・受ける・断る・取り下げる
export function useConnectMutation<T>(mutationFn: (value: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.connectRequests });
      void queryClient.invalidateQueries({ queryKey: keys.rooms });
    },
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: adminApi.createTenant,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.tenants }),
  });
}

export function useSetUserTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, tenantId }: { userId: string; tenantId: string | null }) =>
      adminApi.setUserTenant(userId, tenantId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.users }),
  });
}
