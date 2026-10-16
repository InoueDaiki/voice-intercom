// ルートは src/routes のファイル名で決める(@react-router/fs-routes の flatRoutes)。
// 例: _admin.rooms.$roomId._index.tsx → /rooms/:roomId(_admin.tsx のレイアウトの中)
import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes() satisfies RouteConfig;
