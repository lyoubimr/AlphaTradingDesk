# 🌿 Git Flow — AlphaTradingDesk

> Minimal, practical. Two long-lived branches. Feature branches. Semantic commits.

---

## 📐 Branch model

```
main        ─────────────────────────────────────────────────── production
               ▲               ▲               ▲
               │  PR + merge   │               │
develop     ───┴───────────────┴───────────────┴─────────────── integration
               ▲       ▲               ▲
               │       │               │
feat/x  ───────┘   fix/y ──────┘   chore/z ────┘              feature branches
```

| Branch | Lives forever? | Purpose | CD triggers? |
|--------|---------------|---------|-------------|
| `main` | ✅ | Production — only receives merges from `develop` | ✅ yes |
| `develop` | ✅ | Integration — all PRs target here | ❌ CI only |
| `feat/<name>` | ❌ delete after merge | New feature | ❌ |
| `fix/<name>` | ❌ delete after merge | Bug fix | ❌ |
| `chore/<name>` | ❌ delete after merge | Deps, config, tooling | ❌ |
| `hotfix/<name>` | ❌ delete after merge | Critical prod fix → branch from `main` | ✅ after merge back |

---

## 🔄 Normal feature flow

```bash
# 1. Start from develop (always up to date)
git checkout develop && git pull

# 2. Create feature branch
git checkout -b feat/my-feature

# 3. Work, commit often
git add -p
git commit -m "feat(scope): add X"
git commit -m "fix(scope): fix edge case in Y"

# 4. Push + open PR → develop
git push -u origin feat/my-feature
# Open PR on GitHub: feat/my-feature → develop

# 5. CI runs automatically (lint + tests + docker build)
# Fix any failures, push again

# 6. Merge PR into develop (merge commit — default)
# → delete branch after merge

# 7. When ready to release: open PR develop → main
# → CI runs again
# → Merge → CD triggers → new release
```

---

## 🚨 Hotfix flow (critical prod bug)

```bash
# Branch from main — NOT develop
git checkout main && git pull
git checkout -b hotfix/critical-bug

git commit -m "fix(scope): patch critical bug"

# PR → main  (bypasses develop, goes straight to prod)
# After merge: backport to develop
git checkout develop
git merge hotfix/critical-bug
git push origin develop
```

---

## 💬 Commit convention

Format: `<type>(<scope>): <short description>`  
Rules: imperative mood · max 72 chars · no period at end · English

### Types and their effect on versioning

| Type | Version bump | Deploy? | Example |
|------|-------------|---------|---------|
| `feat` | **MINOR** `v1.0 → v1.1` | ✅ | `feat(trades): add multi-TP support` |
| `feat!` | **MAJOR** `v1.0 → v2.0` | ✅ | `feat!: redesign trade schema` |
| `fix` | **PATCH** `v1.0.0 → v1.0.1` | ✅ | `fix(api): handle null stop loss` |
| `chore` | patch | ✅ | `chore(deps): bump FastAPI to 0.115` |
| `refactor` | patch | ✅ | `refactor(service): extract lot size helper` |
| `docs` | none | ❌ | `docs(readme): update setup guide` |
| `test` | none | ❌ | `test(trades): add close trade unit test` |
| `ci` | none | ❌ | `ci(deploy): add Tailscale step` |
| `db` | none | ❌ | `db: add snapshots migration` |
| `perf` | patch | ✅ | `perf(query): index trades by profile_id` |
| `style` | none | ❌ | `style: fix indentation` |

> ⚡ **Rule of thumb:** if the PR has at least one `feat:` or `fix:` commit →
> CD fires after merge to `main` and a new version is released.
> If it has only `docs:`/`test:`/`ci:` → CI only, no deploy.

### Scopes (common)

```
backend · frontend · api · db · ci · deploy · config
trades · goals · risk · strategies · market-analysis · profiles · brokers
```

### Breaking changes

```bash
# Option 1: exclamation mark
feat!: redesign risk API — remove v1 endpoints

# Option 2: footer in commit body
feat(api): redesign risk calculation

BREAKING CHANGE: /api/v1/risk removed, use /api/v2/risk
```

---

## 🔀 Merge strategy on GitHub

| Strategy | Use when | Notes |
|----------|----------|-------|
| **Merge commit** (default) | Always for `develop → main` | CD scans all commits → picks highest bump |
| **Squash merge** | Feature branches with messy WIP commits | **Must set the squash message to the right type** (`feat:` / `fix:`) |
| **Rebase** | Clean history preferred | Same semver logic as merge commit |

> ✅ **Recommended default:** merge commit for `develop → main`, squash for feature branches.

---

## 🏷️ Versioning (semver)

Versions are computed automatically by CD from commit messages:

```
No prior tag → starts from v0.0.0

v0.0.0  +  feat:  →  v0.1.0
v0.1.0  +  fix:   →  v0.1.1
v0.1.1  +  feat!: →  v1.0.0
v1.0.0  +  feat:  →  v1.1.0
v1.1.0  +  fix:   →  v1.1.1
```

### Force a specific starting version

```bash
# To start at v1.0.0 on first release:
git tag v0.9.0 && git push origin v0.9.0
# Then merge a feat: PR → main → CD creates v1.0.0
```

---

## 📋 Quick reference

```bash
# Start work
git checkout develop && git pull
git checkout -b feat/my-feature

# Daily
git add -p && git commit -m "feat(scope): description"

# Publish
git push -u origin feat/my-feature
# → open PR on GitHub → develop

# Release
# → open PR develop → main on GitHub
# → merge commit → CD auto-deploys

# Check tags
git tag --sort=-v:refname | head -5
```
