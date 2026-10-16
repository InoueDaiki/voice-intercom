// ルートは src/routes のファイル名で決める(@react-router/fs-routes の flatRoutes)。
// 例: _app.rooms.$roomId.tsx → /rooms/:roomId(_app.tsx のレイアウトの中)
import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes() satisfies RouteConfig;
