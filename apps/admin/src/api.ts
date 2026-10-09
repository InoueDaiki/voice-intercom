import { createApiClient } from "@voice-intercom/api-client";

import { getAccessToken } from "./auth.ts";
import { config } from "./config.ts";

export const api = createApiClient({ baseUrl: config.apiBaseUrl, getAccessToken });
