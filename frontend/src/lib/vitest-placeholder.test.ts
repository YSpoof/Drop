import { expect, test } from "vitest";

import { SHARE_CODE_DIGITS } from "#lib/consts.js";

test("vitest runs and resolves #lib imports", () => {
  expect(SHARE_CODE_DIGITS).toBeGreaterThan(0);
});
