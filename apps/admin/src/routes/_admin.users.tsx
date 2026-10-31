import { Alert, Button, ConfirmDialog, Field, Input, LoadErrorAlert, PageHeader, Select, Table, Td, Th } from "@voice-intercom/ui-web";
import { useState } from "react";
import { useAuth } from "react-oidc-context";
import { Link } from "react-router";

import { ApiError, type Room, type Tenant, type User } from "../adminApi.ts";
import { ADMIN_GROUP, groupsOf, OPERATOR_GROUP } from "../auth.ts";
import { useRooms, useSetUserTenant, useTenants, useUsers } from "../queries.ts";
import { errorMessage, formatDateTime, isIncomplete, LANGUAGE_LABELS } from "../rooms.ts";

// 管理者には自分のテナントの人と所属しているルームを、運営者にはすべての人とテナント(変えられる)を出す
export default function UserList() {
  const { user } = useAuth();
  const groups = user ? groupsOf(user) : [];
  const isAdmin = groups.includes(ADMIN_GROUP);
  const isOperator = groups.includes(OPERATOR_GROUP);
  const users = useUsers();
  const rooms = useRooms(isAdmin);
  const tenants = useTenants(isOperator);
  const [filter, setFilter] = useState("");

  // user_id → 所属しているルーム(ルーム一覧の member_ids と突き合わせる)
  const roomsByUser = new Map<string, Room[]>();
  // 削除の途中のルームは、メンバーにはもう無いルームなので出さない
  for (const room of (rooms.data ?? []).filter((r) => !r.deleting_at)) {
    for (const id of room.member_ids) {
      roomsByUser.set(id, [...(roomsByUser.get(id) ?? []), room]);
    }
  }

  const needle = filter.trim().toLocaleLowerCase();
  const shown = [...(users.data ?? [])]
    .filter((u) => needle === "" || u.display_name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));

  return (
    <section>
      <PageHeader
        title="ユーザー"
        description={
          isOperator
            ? "アプリでプロフィール(表示名と言語)を登録したユーザーです。テナントを選ぶと、そのテナントに入れます。所属を変えると、元のテナントのルームから外れます。"
            : "自分のテナントで、アプリでプロフィール(表示名と言語)を登録したユーザーです。"
        }
      />
      {users.isPending && <p className="text-fg-muted">読み込み中…</p>}
      {users.isError && (
        <LoadErrorAlert
          onRetry={() => void users.refetch()}
          // 権限が無いのは読み込み直しても変わらない
          retryable={!(users.error instanceof ApiError && users.error.status === 403)}
        >
          ユーザーの一覧を取得できません:{" "}
          {users.error instanceof ApiError && users.error.status === 403
            ? "ユーザーの一覧を見る権限がありません。"
            : errorMessage(users.error)}
        </LoadErrorAlert>
      )}
      {users.data &&
        (users.data.length === 0 ? (
          <p className="text-fg-muted">登録したユーザーはまだいません。</p>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="名前で絞り込む" className="w-full max-w-xs">
                <Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="表示名の一部" />
              </Field>
              <span className="pb-2 text-sm text-fg-muted">
                {users.data.length}人中 {shown.length}人
              </span>
            </div>
            {isAdmin && rooms.isError && (
              <Alert tone="danger">
                ルームの一覧を取得できないため、所属しているルームを出せません: {errorMessage(rooms.error)}
              </Alert>
            )}
            {shown.length === 0 ? (
              <p className="text-fg-muted">「{filter}」に当てはまるユーザーはいません。</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>表示名</Th>
                    <Th shrink>言語</Th>
                    <Th shrink>ユーザー ID</Th>
                    <Th shrink>登録日時</Th>
                    {isOperator && <Th>テナント</Th>}
                    {isAdmin && <Th>所属しているルーム</Th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((user) => {
                    const joined = roomsByUser.get(user.user_id) ?? [];
                    return (
                      <tr key={user.user_id}>
                        {/* 名前とルームの列は、幅の狭い画面でも読める幅を取る */}
                        <Td className="min-w-32 font-medium">{user.display_name}</Td>
                        <Td shrink>{LANGUAGE_LABELS[user.language]}</Td>
                        <Td shrink>
                          <code>{user.user_id}</code>
                        </Td>
                        <Td shrink className="text-fg-muted">
                          {formatDateTime(user.created_at)}
                        </Td>
                        {isOperator && (
                          <Td className="min-w-48">
                            <TenantSelect user={user} tenants={tenants.data} />
                          </Td>
                        )}
                        {isAdmin && (
                          <Td className="min-w-48">
                            {rooms.isPending && <span className="text-fg-muted">読み込み中…</span>}
                            {rooms.data &&
                              (joined.length === 0 ? (
                                <span className="text-fg-muted">なし</span>
                              ) : (
                                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                                  {joined.map((room) => (
                                    <li key={room.room_id}>
                                      <Link to={`/rooms/${encodeURIComponent(room.room_id)}`}>{room.name}</Link>
                                    </li>
                                  ))}
                                </ul>
                              ))}
                          </Td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </div>
        ))}
    </section>
  );
}

// ユーザーの所属(運営者)。所属のある人を変えるときは、ルームから外れるので確かめる
function TenantSelect({ user, tenants }: { user: User; tenants: Tenant[] | undefined }) {
  const set = useSetUserTenant();
  // 確かめている間の行き先。null は所属を外す
  const [target, setTarget] = useState<{ tenantId: string | null } | undefined>();
  const tenantName = (id: string | null) =>
    id === null ? "所属なし" : (tenants?.find((t) => t.tenant_id === id)?.name ?? id);
  const change = (tenantId: string | null) => set.mutate({ userId: user.user_id, tenantId });

  return (
    <div className="grid gap-1">
      <Select
        aria-label={`${user.display_name} のテナント`}
        value={user.tenant_id ?? ""}
        disabled={!tenants || set.isPending}
        onChange={(e) => {
          const tenantId = e.target.value || null;
          // 所属の無い人にはルームが無いので、確かめずに入れる
          if (user.tenant_id) {
            setTarget({ tenantId });
          } else {
            change(tenantId);
          }
        }}
      >
        <option value="">所属なし</option>
        {tenants?.map((t) => (
          <option key={t.tenant_id} value={t.tenant_id}>
            {t.name}({t.tenant_id})
          </option>
        ))}
      </Select>
      {isIncomplete(set.error) && set.variables ? (
        <div className="grid justify-items-start gap-1">
          <span className="text-xs text-fg-muted">
            所属は変えましたが、一部のルームから外しきれていません。もう一度押してください。
          </span>
          {/* 同じ PUT で続きを行う */}
          <Button size="sm" disabled={set.isPending} onClick={() => change(set.variables.tenantId)}>
            {set.isPending ? "外しています…" : "ルームから外す操作を続ける"}
          </Button>
        </div>
      ) : (
        set.isError && <span className="text-xs text-danger-fg">{errorMessage(set.error)}</span>
      )}
      <ConfirmDialog
        open={target !== undefined}
        tone="danger"
        title={`${user.display_name} の所属を変えますか?`}
        description={
          target &&
          `「${tenantName(user.tenant_id ?? null)}」から「${tenantName(target.tenantId)}」に変えます。元のテナントのルームからすべて外れ(Connect のルームも)、通話中なら切られます。元に戻しても、ルームには自動で戻りません。最後のオーナーでも外れるので、オーナーの居ないルームが残ることがあります。そのルームは、テナントの管理者がオーナーを決めるかアーカイブします。`
        }
        confirmLabel="所属を変える"
        onConfirm={() => {
          if (target) {
            change(target.tenantId);
          }
          setTarget(undefined);
        }}
        onCancel={() => setTarget(undefined)}
      />
    </div>
  );
}
