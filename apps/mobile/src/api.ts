import { createClientApi } from "@voice-intercom/client-core";

import { getAccessToken } from "./auth.ts";
import { config } from "./config.ts";

export const api = createClientApi({ baseUrl: config.apiBaseUrl, getAccessToken });
