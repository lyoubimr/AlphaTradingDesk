"""One-off script to fix the implement-phase1.md release section."""
import re

path = "docs/deployment/phases/phase1/implement-phase1.md"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# The section starts with the broken emoji heading and ends after the final "Next:" line
pattern = re.compile(
    r"## [^\n]*Deliverable at end of Phase 1.*?(\*\*Next:\*\*[^\n]*\n)",
    re.DOTALL,
)

replacement = """\
## 🚀 Phase 1 — v1.0.0 Release checklist

> Steps 1–11 complete. After this checklist → merge `develop → main` → tag `v1.0.0`.

### Code

- [x] Step 1 — Project bootstrap (FastAPI + Vite + Docker + CI)
- [x] Step 2–3 — Full DB schema + Alembic migrations + seed data
- [x] Step 4–7 — All backend routes (profiles, brokers, trades, strategies, goals, stats, market analysis)
- [x] Step 9 — Settings/Profiles page + ProfilePicker
- [x] Step 10 — Trade form (risk calc, multi-TP, LIMIT lifecycle, expectancy, margin/leverage)
- [x] Step 11 — Goals page (real backend: create, toggle, live progress, KPIs)

### Quality gates

- [ ] `make lint` — ruff + mypy pass (0 errors)
- [ ] `make lint-fe` — eslint pass
- [ ] `make test` — pytest all green
- [ ] `vitest run` — all tests pass
- [ ] Manual QA: create profile → log trade → partial close → full close → goal progress updates

### Git

```bash
# Confirm clean working tree
git status

# Final commit
git add -A && git commit -m "feat(goals): Step 11 — connect Goals page to real backend"

# Merge to main and tag
git checkout main
git merge --no-ff develop -m "feat: Phase 1 complete — v1.0.0"
git tag v1.0.0
git push origin main --tags
```

---

## 📦 Deliverable at end of Phase 1

```
✅ Docker Compose dev stack (API + DB + Frontend)
✅ Full DB schema + seed data
✅ All backend routes tested (Postman / pytest)
✅ All UI pages functional and connected to backend
✅ No JSON config files — everything configurable via UI
✅ Makefile (make dev, make deploy, make db-sync)
✅ scripts/deploy.sh on the Dell
✅ README.md with setup instructions
```

---

**Next:** → `post-implement-phase1.md` → Dell deploy (Step 14)
"""

m = pattern.search(content)
if m:
    new_content = content[: m.start()] + replacement + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"OK: section replaced. New length: {len(new_content)}")
else:
    print("ERROR: pattern not found")
    # Show last 500 chars so we can debug
    print(repr(content[-500:]))
