# Golden test fixtures

These files lock the observable output of the planner and sleep schedule. A failing
golden is evidence to investigate, not permission to refresh the expected output.

To update a golden intentionally:

1. Run the failing test without `-u` and review which records changed and why.
2. Confirm that the behavior change is intended and separately reviewed.
3. Run only the affected test with `npx vitest run <test-file> -u`.
4. Review the resulting golden-file diff line by line before accepting it.

Never update all goldens merely to make a refactor pass.

## What each golden locks

Migrated from `.agent/sessions/睡眠まわり_引き継ぎプロンプト.md` §1i on 2026-08-29;
that handover document has been retired, so this file is the source of truth.

| Golden | Test | What it locks |
|---|---|---|
| `debug-export/*.tsv` (7) | `tests/unit/store/useCalcStore.debug-export.golden.test.ts` | The whole store → planner → debug TSV path, in seven scenarios: candy only / long GSD + incense / all-sleep with partial GSD incense / GSD off + weekly-only incense / candy stock + sleep with partial GSD incense / incense out of stock / real + projected + flower overlap |
| `sleep-schedule/*.txt` (4) | `tests/unit/pokesleep/sleep-schedule.golden.test.ts` | `days(90)` one line per day, across four settings (unlimited / finite / zero incense stock, GSD disabled) spanning three lunar cycles |
| `../../fixtures/backup-v1.golden.json`, `backup-v2.golden.json` | `src/backup/backupCodec.test.ts` | Round-tripping older backup formats |

Two more tests belong to the same safety net even though they own no fixture file:

- `tests/unit/store/useCalcStore.public-api.integration.test.ts` — touches **no internal export**;
  drives add row → sleep target → settings → undo/redo → persist → restore in a fresh instance.
- `tests/unit/i18n/i18n-keys.test.ts` — ja/en key parity, every key passed to `t()` exists,
  and no unused key. Renaming an i18n key without updating its callers surfaces here, not on screen.

## Rules when touching these

- **`_generated/sleep-exp-events.ts` must stay stubbed with `vi.mock`.** `auto-update-events.yml`
  refreshes that generated module **daily**, so depending on the real one makes goldens break on their own.
- **`_generated/full-moon-dates.ts` is a fixed generated file, so use the real one** (you should).
- Normalize only measured timings such as `actualDurationMs`. `deadlineMs` is behavior — keep it fixed.
- Goldens are easy to forget in a commit. **Make sure new fixture files are staged**, or they fail elsewhere.

## Proven to bite

Injecting a fault that moves the `incenseDaysInWeek` week start from Monday to Sunday fails
**5 TSV goldens and 3 daily goldens** (`candy-only` and `events-only-no-gsd` correctly survive:
no sleep, GSD disabled). Changing `fullMoon ? 3 : ...` to `2` fails 3 daily goldens.
