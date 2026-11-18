# Contributing to SynapsVault Frontend

A Stellar-powered marketplace UI built with React, TypeScript, Vite, and Tailwind CSS.

## Local Development

### Prerequisites
- Node.js >=24.15.0 (see `engines` in `package.json`)
- npm (or pnpm)

The repo pins its Node version in `.nvmrc`. If you use nvm, run `nvm use` from the
project root to switch to the pinned Node 24 release before installing dependencies.

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — leave VITE_API_URL empty for local development and set
# VITE_DEV_PROXY_TARGET to your backend (e.g. http://localhost:3000)

# Start dev server
npm run dev
# Open http://localhost:5173
```

The Vite dev server provides hot module reload, but it does **not** typecheck your
code — Vite strips types without checking them. Run `npm run typecheck`
(`tsc --noEmit`) separately to catch type errors, and run it before opening a PR.

### API Environment Variables

For local development, keep `VITE_API_URL` **empty** and point
`VITE_DEV_PROXY_TARGET` at your backend instead. The Vite dev server proxies
API requests to that target, which avoids CORS issues and keeps the browser
talking to a single origin. See `.env.example` for the full list of variables.

```bash
# .env (local development)
VITE_API_URL=
VITE_DEV_PROXY_TARGET=http://localhost:3000
```

Only set `VITE_API_URL` when the frontend must call a backend directly (for
example, a deployed environment with a fictional host such as
`https://api.example.test`).

## Docker Development

```bash
# Build image
npm run docker:build

# Run container
npm run docker:run
# Open http://localhost:8080
```

See [Local Docker Smoke Checks](#local-docker-smoke-checks) to verify the
container is healthy before pushing. If port 8080 is already in use, see
[Port 8080 already in use?](#port-8080-already-in-use).

## Local Docker Smoke Checks

CI runs three checks against the container on port 8080 (see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml), job `docker`).
Run the same checks locally to catch regressions before they hit CI.

### 1. Start the container

```bash
docker build -t synapsvault-frontend:local .
docker run -d --name web -p 8080:8080 synapsvault-frontend:local
```

### 2. Health endpoint

The image exposes a `/health` route. Poll it until the server is ready (it
may take a few seconds to start), then assert a 200 response:

```bash
for i in $(seq 1 15); do
  curl -fsS http://localhost:8080/health && break
  sleep 1
done
curl -fsS http://localhost:8080/health
```

A successful response means the server is up and the health route is reachable.

### 3. App-shell check

The root path must return the HTML app shell — specifically the `<div
id="root">` mount point that React attaches to:

```bash
curl -fsS http://localhost:8080/ | grep -q '<div id="root">'
```

### 4. Deep-link / SPA fallback check

The server must serve the same app shell for any path, so that client-side
routes such as `/marketplace/listing/abc123` work after a hard refresh or
direct navigation:

```bash
curl -fsS http://localhost:8080/marketplace/listing/abc123 | grep -q '<div id="root">'
```

If this check fails, the server is not configured to fall back unknown paths to
`index.html`. Fix the Nginx (or equivalent) `try_files` rule in the
`Dockerfile`.

### 5. Docker HEALTHCHECK status

The image defines its own `HEALTHCHECK` instruction. After the checks above,
verify that Docker itself reports the container as `healthy`:

```bash
for i in $(seq 1 20); do
  status=$(docker inspect --format '{{.State.Health.Status}}' web)
  [ "$status" = healthy ] && break
  sleep 2
done
echo "container health: $status"
[ "$status" = healthy ]
```

If the status stays `starting` or flips to `unhealthy`, see
[Container stays unhealthy or won't start](#container-stays-unhealthy-or-wont-start).

### Cleanup

```bash
docker stop web && docker rm web
```

## Branch Strategy

| Branch | Purpose | Deploy Target |
|--------|---------|----------------|
| `main` | Production-ready | Vercel → production |
| `dev` | Staging/integration | Vercel preview |
| `feat/*` | Feature branches | PR to `dev` |
| `fix/*` | Bug fixes | PR to `dev` |
| `chore/*` | Maintenance | PR to `dev` |

CI runs only on pushes to `main`/`dev` and on PRs targeting `main`/`dev` — see
[CI Branch Triggers](#ci-branch-triggers) for why a push to a feature branch may
produce no run.

## CI Branch Triggers

CI only runs on specific branches. The workflow's `on` block (see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) filters both event
types:

```yaml
on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]
```

- **Push** runs CI automatically on direct pushes to `main` or `dev`.
- **Pull request** runs CI when a PR's target (base) branch is `main` or `dev`.

**Why a push may produce no run.** A push to any other branch — such as
`feat/login`, `fix/typo`, or `chore/deps` — triggers nothing, because those
branches are not in the `push.branches` list. CI starts for such a branch only
once you open a PR targeting `main` or `dev`: the `pull_request` filter matches
the PR's base branch, so `feat/login` → `dev` runs CI, while a standalone push
to `feat/login` does not.

This keeps CI focused on the branches that matter for integration and release
(`main`, `dev`) and on PRs seeking to merge into them, rather than running on
every feature-branch commit.

## Development Workflow

1. **Create feature branch from dev:**
   ```bash
   git checkout -b feat/my-feature dev
   ```

2. **Make changes and test locally:**
   ```bash
   npm run dev
   npm run test:watch
   ```

3. **Before committing, verify:**
   ```bash
   npm run lint:fix    # Auto-fix style issues, then review the diff
   npm run lint        # Confirm no remaining lint errors (CI enforces it)
   npm run typecheck   # Type safety
   npm run test        # All tests pass
   npm run build       # Production build works
   # or simply: npm run check
   node scripts/scan-secrets.mjs   # No credentials in built assets
   ```

   To verify the built output locally, see
   [Previewing a Production Build](#previewing-a-production-build).
   For details on reviewing auto-fix changes, see [Linting](#linting).
   To understand what the secret scanner checks and how to interpret its
   output, see [Secret Scanner](#secret-scanner).

   CI also enforces a production dependency audit that `npm run check` does not
   include — see [Production Dependency Audit](#production-dependency-audit) to
   run it locally before opening a PR.

4. **Commit with conventional format (see below)**

5. **Push and create PR to `dev`**

   Pushing a new commit to an open PR (or to `main`/`dev`) cancels any CI run
   still in progress for that same ref — see
   [CI Concurrency and Cancelled Runs](#ci-concurrency-and-cancelled-runs).

6. **After review + merge to `dev`:**
   - Staging deploy to Vercel preview
   - Create release PR to `main`

## Testing

```bash
npm run test           # Run all tests once
npm run test:watch    # Watch mode for development
npm run test:ui       # Visual UI for test runner
```

Tests use Vitest + React Testing Library. Focus on user behavior, not implementation details.

### Vitest UI

`npm run test:ui` uses `@vitest/ui`, which is declared in `devDependencies`, so
it is installed by `npm ci` / `npm install` — no extra install step or prompt.
Its version must match `vitest` exactly (it declares `vitest` as a peer at the
same version), so bump both packages together.

## Previewing a Production Build

Build the app and serve the generated assets locally:

```bash
npm run build     # Outputs to dist/
npm run preview   # Serves the built assets (default: http://localhost:4173)
```

`npm run preview` serves the files produced by `npm run build` — it does not
run the dev server, hot module reload, or the dev proxy. Use it to check the
production bundle before opening a PR.

## Production Build (build:prod)

```bash
npm run build:prod
```

This runs the production build with `NODE_ENV=production` and writes the
generated assets to the `dist/` directory. Deploy or inspect `dist/` after the
command completes. CI's `build` job also uploads its own `dist/` output as a
downloadable artifact — see [CI dist Artifact](#ci-dist-artifact).

## CI dist Artifact

The `build` job (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml),
step `Upload dist artifact`) uploads its build output as a named artifact:

```yaml
- name: Upload dist artifact
  uses: actions/upload-artifact@v7
  with:
    name: dist
    path: dist/
    retention-days: 7
```

**Where it appears.** Once the run finishes, the `dist` artifact is listed in
the **Artifacts** section of the workflow run's summary page — open the
repository's Actions tab, click the CI run, and scroll to "Artifacts". It
holds the contents of the `dist/` directory produced by `npm run build` in the
`build` job. Download it as a zip to inspect that exact build without
rebuilding locally.

**Retention.** `retention-days: 7` keeps the artifact downloadable for seven
days; GitHub then deletes it automatically. Once it is gone it can't be
recovered — re-run the workflow or rebuild locally to produce a fresh `dist/`.

## Production Dependency Audit

CI's `test` job audits production dependencies right after installing them
(see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), step
`Audit dependencies`):

```bash
npm audit --omit=dev --audit-level=high
```

**What the flags do**

- `--omit=dev` audits only production dependencies, skipping `devDependencies`.
  Vulnerabilities in dev-only tooling (Vite, Vitest, ESLint, …) are excluded
  entirely; only those reachable from a production dependency — including
  transitive deps — are considered.
- `--audit-level=high` sets the failure threshold. The command exits non-zero
  only when a production dependency has a `high` or `critical` advisory; `low`
  and `moderate` advisories are still reported but do not fail the build.

In short, CI fails only when a production dependency has a `high` or `critical`
vulnerability.

**This check is not part of `npm run check`**, which covers lint, typecheck,
tests, bundle budgets, and secret scanning — but not the audit. Run it
separately before opening a PR:

```bash
npm install                               # keep package-lock.json in sync first
npm audit --omit=dev --audit-level=high   # the exact command CI runs
```

Exit code `0` means the production tree is clean at the `high` threshold; any
other code means at least one `high`/`critical` advisory was found.

**If it fails**, address the reported advisory and re-run until the command
exits `0`. Safe updates can be auto-applied with `npm audit fix`; for a
major-version bump or a transitive dependency, update the package that
introduces it. Always confirm the fix with the same `--omit=dev
--audit-level=high` flags CI uses.

## CI Concurrency and Cancelled Runs

The workflow sets a top-level `concurrency` block (see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) that cancels older
runs when a newer one starts on the same branch or PR:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**Group key.** Runs are grouped by `${{ github.workflow }}-${{ github.ref }}`:

- `github.workflow` is the workflow name — `CI` (from `name: CI`).
- `github.ref` is the ref that triggered the run: `refs/heads/main` or
  `refs/heads/dev` for a branch push, or `refs/pull/<number>/merge` for a pull
  request (for example, `refs/pull/4242/merge`).

Each branch and each PR therefore gets its own group, such as
`CI-refs/heads/main`, `CI-refs/heads/dev`, or `CI-refs/pull/4242/merge`.

**`cancel-in-progress: true`** makes GitHub cancel the older in-progress run in
that group whenever a new run starts.

**What this means in practice**

- Pushing a new commit to an open PR cancels that PR's still-running CI — the
  two pushes share one `refs/pull/<number>/merge` group.
- Pushing a new commit to `main` cancels the in-progress `main` run; the same
  applies to `dev`. `main` and `dev` are separate groups, so a push to one does
  not cancel a run on the other.
- One PR's push does not cancel another PR's run — different PR numbers mean
  different refs and different groups.
- The group is keyed on the workflow name, so only the `CI` workflow is
  affected; other workflows run independently.

When a run is cancelled, GitHub marks it cancelled and stops any in-progress
job in it (`test`, `build`, `docker`); jobs that have not started yet will not
start. This keeps CI fast and avoids running checks against commits you have
already superseded.

## Secret Scanner

`scripts/scan-secrets.mjs` checks every `.js`, `.html`, `.json`, and `.css`
file under `dist/` for patterns that look like accidentally bundled credentials:

| Pattern | Example (fictional) |
|---------|---------------------|
| Stellar private key | `SABCDEFGHIJ1234567890ABCDEFGHIJ1234567890ABCDEFGHIJ123456` |
| PEM private key header | `-----BEGIN OPENSSH PRIVATE KEY-----` |
| AWS access key | `AKIAIOSFODNN7EXAMPLE` |

Run it after a build:

```bash
npm run build
node scripts/scan-secrets.mjs
```

**Clean output** (no matches):

```
Built assets: no recognized private-key patterns found.
```

**Failure output** (match found):

```
dist/assets/index-Dq3kL8mN.js: possible Stellar private key
```

The scanner prints only the file path and pattern label — never the matched
value itself. The process exits with code 1 when any match is found, so it
blocks CI the same way a failing test does.

If you get a false positive from a test fixture or generated stub, check that
no real credential was accidentally inlined into the bundle. If the match is
genuinely a non-secret (for example, a base32 string that happens to match the
Stellar key regex), move the value out of the bundled source or rename it so
it no longer matches.

## Linting

The project uses ESLint with the TypeScript and React Hooks plugins. CI runs
`npm run lint` and fails the build on any error, so lint must pass before you
push.

```bash
npm run lint        # Report all lint errors (read-only)
npm run lint:fix    # Auto-fix what ESLint can correct in place
```

`lint:fix` rewrites files directly — it does not stage or commit anything.
After running it, review the diff before you stage so you understand every
change:

```bash
npm run lint:fix
git diff            # Review all edits made by the auto-fixer
git add -p          # Stage interactively if you want fine-grained control
```

Not every error is auto-fixable. Formatting changes (quote style, semicolons,
trailing commas) and simple import ordering are fixed automatically; logic
errors flagged by the React Hooks plugin (missing dependencies in `useEffect`,
conditional hook calls) require manual correction. After `lint:fix`, re-run
`npm run lint` to confirm no errors remain.

### Linting a single file

When you only want to check one file — for example while iterating on a
component — pass the path directly to `npx eslint`:

```bash
npx eslint src/components/ResourceCard.tsx
```

To auto-fix that file alone:

```bash
npx eslint --fix src/components/ResourceCard.tsx
```

The config (`eslint.config.js`) lints `**/*.{ts,tsx}` source files plus
`*.config.{js,ts}` and `scripts/**/*.{js,mjs}`. Passing a path outside those
patterns (for example a plain `.js` file in `src/`) produces no output because
no rule block matches it — not because the file is error-free.

Example output for a file with errors:

```
/workspaces/frontend/src/components/ResourceCard.tsx
  12:7  error  'setItems' is assigned a value but never used  @typescript-eslint/no-unused-vars
  28:3  error  React Hook useEffect has a missing dependency: 'fetchData'  react-hooks/exhaustive-deps

✖ 2 problems (2 errors, 0 warnings)
  0 errors and 0 warnings potentially fixable with the `--fix` option.
```

The first column is the line:column of the finding, the second is the rule
name. Rules from `react-hooks/exhaustive-deps` are not auto-fixable and need
manual correction; `@typescript-eslint/no-unused-vars` errors are also not
auto-fixed (rename or prefix unused variables with `_` to suppress them, as
configured in `eslint.config.js`).

## Code Standards

- **TypeScript**: Strict mode, no `any` without comment
- **Components**: Functional components with hooks
- **Styling**: Use semantic Tailwind tokens (`bg-surface`, `text-fg-muted`, `border-line`) — see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)
- **Accessibility**: ARIA labels, keyboard navigation
- **Performance**: Code-split routes, memoize expensive renders
- **Errors**: Use Sentry for tracking, user-friendly error messages

## Design System

Tokens live in `src/styles/tokens.css` and are exposed to Tailwind as semantic
classes that adapt to light/dark automatically. Read
[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) before adding UI.

## Adding a New Page

Pages are rendered as tabs from `src/App.tsx`; there is no `src/pages` directory.

1. **Create component:** `src/components/MyPage.tsx`
2. **Add tests:** `src/components/MyPage.test.tsx`
3. **Wire it into the tab navigation in `src/App.tsx`:**
   - Extend the `Tab` union with your new tab id (e.g. `'my-page'`)
   - Add a nav entry for the tab in the navigation list
   - Render `<MyPage />` in the tab switch for that id
4. **Test:** `npm run dev` and verify the tab renders and switches correctly

## Commit Format (Conventional Commits)

```
feat(ui): add subscription plan selector
fix(wallet): handle Freighter disconnect race condition
test(catalog): add search filter tests
docs: update component library
refactor(theme): extract color variables to custom properties
chore: upgrade vite to 6.0
perf(catalog): memoize ResourceCard component
```

**Types:** feat, fix, test, docs, refactor, chore, perf, style

## Code Review Checklist

- [ ] Lint passes (`npm run lint`)
- [ ] TypeScript compiles (`npm run typecheck`)
- [ ] Tests pass (`npm run test`)
- [ ] Secret scanner passes (`node scripts/scan-secrets.mjs` after `npm run build`)
- [ ] Bundle size acceptable (check Vite output)
- [ ] No hardcoded colors/spacing (use CSS vars)
- [ ] Accessible (keyboard nav, ARIA labels)
- [ ] Mobile responsive (tested at 320px+)
- [ ] Follows conventional commit format
- [ ] PR description explains "why", not "what"

## Wallet Integration

Uses Stellar Freighter for wallet connection.

- [`src/lib/freighter.ts`](./src/lib/freighter.ts) — Freighter helpers such as
  `loadFreighter`, `signWithFreighter`, and `isFreighterInstalled`
- [`src/hooks/useWalletConnection.ts`](./src/hooks/useWalletConnection.ts) — connection
  state, `connect`/`disconnect`, and restore-on-mount behavior

Example public key used in tests and docs: `GABCD...` (placeholder only — never commit
real keys or secrets).

## Payment Integration

Uses x402 protocol via `@x402/fetch` and `@x402/stellar`. See `src/api/payments.ts`.

## Troubleshooting

**Port 5173 already in use?**
```bash
npm run dev -- --port 5174
```

**Port 8080 already in use?**

`npm run docker:run` always binds host port 8080 (it runs
`docker run -p 8080:8080 …`). The script accepts no port argument, so call
`docker run` directly to map a different host port to the container's fixed
port 8080:

```bash
docker run -p 9090:8080 synapsvault-frontend:latest
# Open http://localhost:9090
```

Replace `9090` with any free port. The container always listens on 8080
internally; only the host side of `-p HOST:8080` changes.

**Container stays unhealthy or won't start?**

The `Dockerfile` configures the health check as:

```
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
```

Docker probes `/health` every 2 seconds during the 10-second start period, then
every 30 seconds after that. A probe must respond within 5 seconds. After three
consecutive failures the container is marked `unhealthy`.

**Read the health-check log** to see exactly which probes passed or failed and
what output they returned:

```bash
docker inspect --format '{{json .State.Health}}' web
```

Example output (fictional):

```json
{
  "Status": "unhealthy",
  "FailingStreak": 3,
  "Log": [
    {
      "Start": "2024-11-01T12:00:00.000Z",
      "End":   "2024-11-01T12:00:05.001Z",
      "ExitCode": 1,
      "Output": "wget: can't connect to remote host (127.0.0.1): Connection refused\n"
    }
  ]
}
```

`ExitCode: 0` means the probe succeeded; any other value means it failed.
`Output` contains whatever `wget` (or the error) printed to stdout/stderr.

**Read the container logs** to see nginx startup errors and request logs:

```bash
docker logs web
```

The image runs nginx in the foreground (`daemon off`), so all nginx output —
including startup errors, access logs, and error logs — goes straight to
stdout/stderr and appears in `docker logs`. Add `--tail 50` to limit output or
`-f` to follow in real time:

```bash
docker logs --tail 50 web   # last 50 lines
docker logs -f web           # stream live
```

Common things to look for:

- `[emerg]` lines indicate nginx failed to start (usually a config syntax error).
- `"GET /health HTTP/1.1" 200` confirms health probes are reaching nginx.
- A complete absence of request lines while the status is `unhealthy` means
  the port binding failed before nginx could accept connections.

**Build too large?**
```bash
npm run bundle:stats
# Opens stats.html showing bundle breakdown
```

**Tests failing?**
```bash
npm run test:watch
# Rerun on file changes
```

## Questions?

- Open a GitHub issue
- Check existing PRs for similar work
- Ask in Stellar Dev Discord #synapsvault
