import { createBrowserRouter } from "react-router";

import { Layout } from "./Layout.tsx";
import { RequireAdmin } from "./RequireAdmin.tsx";
import { Callback } from "./pages/Callback.tsx";
import { Home } from "./pages/Home.tsx";
import { NotFound } from "./pages/NotFound.tsx";

export const router = createBrowserRouter([
  // 認可コードを受け取る(処理は AuthProvider がする)
  { path: "/callback", element: <Callback /> },
  {
    element: <RequireAdmin />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);
