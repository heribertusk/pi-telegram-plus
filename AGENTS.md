# pi-telegram-plus (fork)

Fork of `jalyfeng/pi-telegram-plus`. Upstream remote: `upstream`. Backup remote: `origin` = `github.com/heribertusk/pi-telegram-plus` (**public**). Branch: `master`. Sync: `git fetch upstream && git merge upstream/master`.

## Security contract (public repo)

This repo syncs to a PUBLIC GitHub fork. Absolute rules:

1. **No secrets in tracked files or commit history** — API keys, tokens (bot/gho_/ghp_/sk-), passwords, connection strings. Runtime config comes from `PI_TELEGRAM_*` env vars and `~/.pi/agent/tg.json` (outside repo, gitignored pattern `*.log`/`.env*` already in place). Never copy values from tg.json into code, tests, or docs.
2. **No hardcoded machine/personal identifiers** — no absolute paths (`/Users/...`), Telegram chat/user IDs, hostnames in source. Use env/config.
3. **Pre-push scan** — before every push to `origin`, run:
   ```
   gitleaks detect --source . --redact
   ```
   Known false positives: `lib/__tests__/model-auth-compat.test.ts` (upstream's redaction tests use dummy strings). Zero real leaks as of 2026-09-01 audit.
4. **History rewrite is out** — upstream baseline commits are public; only fork commits (post-`1ba0d32`) are ours to scrub if a leak ever lands there: rewrite with `git rebase`, force-push, rotate the leaked credential immediately.
