import type { Handle } from "@sveltejs/kit/hooks";

import appCss from "./app.css?url";

export const handle: Handle = async ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: ({ html }) => html.replaceAll("__DROP_APP_CSS__", appCss),
  });
