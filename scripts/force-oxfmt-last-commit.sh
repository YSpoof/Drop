#!/bin/sh
git diff-tree --no-commit-id --name-only -r HEAD |
  xargs -r pnpm exec oxfmt
git add -u
git commit --amend --no-edit --no-verify