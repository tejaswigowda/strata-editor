# Eval results — decompose, don't expand

Companion data for *Decompose, Don't Expand: Capability-Independent AI Systems by Construction*.
Generated from `eval-results.jsonl`. No number in this file was typed by hand.

## Setup

- **Runs:** 38 total, 36 used, 2 excluded (below).
- **Fixtures:** 88 per run — 22 op-selection, 22 selector-resolution, 22 arg-extraction, 13 multi-op, 9 labelling.
- **Scoring:** resolved-node level. Scorer `sha256:4369835530b93711` for every run.
- **Local models:** Qwen2.5-Coder via Ollama 0.40.6, Q4_K_M, `/v1/chat/completions`, `temperature=0` forwarded, trained context 32768, effective context read from `/api/ps`.
- **Frontier models:** Anthropic client path. `temperature` is **not** forwarded for Claude 5 models; `max_tokens_effective` 16000.
- **Origin:** http://localhost:5503. **System under test:** commits 6b7cbb7, 888d97e.
- No model was fine-tuned or trained for this task. All are stock checkpoints.

### Excluded runs

| run | model | condition | reason |
|---|---|---|---|
| `20261027T205140Z-6ohui7` | claude-haiku-5-5 | constrained | 62 of 88 rows `exception`; 17 s; no usage reported |
| `20261027T211104Z-vfodge` | claude-sonnet-5-5 | scaffolded | 71 of 88 rows `exception`; 9 s; no usage reported |

Both reported `status: complete` because the harness loop finished; the individual API calls failed. Both have clean replacement repeats, so no cell is lost. **`run_end.status` does not account for per-call failure rates** — a gap worth closing in the harness.

## Bare

| task | n | 1.5B | Haiku 5.5 | Sonnet 5.5 | Fable 5.1 |
|---|--:|--:|--:|--:|--:|
| op-selection | 22 | 64% ±14 | 59% | 77% | 86% |
| selector-resolution | 22 | 42% ±9 | 9% | 18% | 18% |
| arg-extraction | 22 | 86% ±0 | 82% | 82% | 91% |
| multi-op | 13 | 21% ±8 | 0% | 15% | 8% |
| labelling | 9 | 33% ±0 | 56% | 67% | 67% |
| **overall** | 88 | **55%** ±7 | **43%** | **53%** | **57%** |

## Scaffolded

| task | n | 0.5B | 1.5B | 3B | 7B | 14B | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 | Fable 5.1 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| op-selection | 22 | 9% ±0 | 76% ±5 | 77% | 95% | 95% | 95% | 100% | 95% | 100% |
| selector-resolution | 22 | 5% ±0 | 55% ±0 | 36% | 41% | 45% | 59% | 59% | 50% | 68% |
| arg-extraction | 22 | 68% ±0 | 91% ±0 | 86% | 95% | 95% | 95% | 95% | 95% | 95% |
| multi-op | 13 | 0% ±0 | 54% ±0 | 46% | 38% | 62% | 77% | 77% | 69% | 85% |
| labelling | 9 | 67% ±0 | 78% ±0 | 67% | 78% | 89% | 89% | 89% | 100% | 100% |
| **overall** | 88 | **27%** ±0 | **71%** ±1 | **64%** | **72%** | **77%** | **83%** | **84%** | **81%** | **89%** |

## Constrained

| task | n | 1.5B | Haiku 5.5 | Sonnet 5.5 | Fable 5.1 |
|---|--:|--:|--:|--:|--:|
| op-selection | 22 | 64% ±0 | 91% | 86% | 91% |
| selector-resolution | 22 | 58% ±9 | 59% | 59% | 68% |
| arg-extraction | 22 | 91% ±0 | 95% | 91% | 95% |
| multi-op | 13 | 62% ±0 | 69% | 62% | 69% |
| labelling | 9 | 78% ±0 | 89% | 89% | 89% |
| **overall** | 88 | **70%** ±2 | **81%** | **77%** | **83%** |

## Host-resolved

| task | n | 0.5B | 1.5B | 3B | 7B | 14B | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 | Fable 5.1 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| op-selection | 22 | 86% | 86% ±0 | 86% | 86% | 86% | 86% | 86% | 86% | 86% |
| selector-resolution | 22 | 91% | 91% ±0 | 91% | 91% | 91% | 86% | 91% | 91% | 91% |
| arg-extraction | 22 | 86% | 91% ±0 | 91% | 91% | 91% | 95% | 91% | 91% | 91% |
| multi-op | 13 | 85% | 85% ±0 | 85% | 85% | 85% | 77% | 85% | 77% | 85% |
| labelling | 9 | 67% | 78% ±0 | 67% | 78% | 89% | 78% | 89% | 100% | 100% |
| **overall** | 88 | **85%** | **88%** ±0 | **86%** | **88%** | **89%** | **86%** | **89%** | **89%** | **90%** |

`±` is the spread across repeats where more than one exists.

## Fixture-level agreement under host resolution

Each cell: fixtures on which the model agrees with the 0.5B model, repeat 1.

| model | op-selection | selector-resolution | arg-extraction | multi-op | labelling |
|---|--:|--:|--:|--:|--:|
| 1.5B | 22/22 | 22/22 | 21/22 | 13/13 | 8/9 |
| 3B | 22/22 | 22/22 | 21/22 | 13/13 | 7/9 |
| 7B | 22/22 | 22/22 | 21/22 | 13/13 | 8/9 |
| 14B | 22/22 | 22/22 | 21/22 | 13/13 | 7/9 |
| Haiku 5.5 | 20/22 | 21/22 | 20/22 | 12/13 | 8/9 |
| Sonnet 5.5 | 22/22 | 22/22 | 21/22 | 13/13 | 7/9 |
| Opus 5.5 | 22/22 | 22/22 | 21/22 | 12/13 | 6/9 |
| Fable 5.1 | 22/22 | 22/22 | 21/22 | 13/13 | 6/9 |

## Host resolution counters

Identical in **every** host-resolved run, across all nine models:

```json
{
  "ambiguous_ask": 1,
  "op_host_resolved": 31,
  "op_total": 32,
  "selector_host_resolved": 31,
  "selector_total": 32
}
```

The host resolves the same 31 of 32 emitted operations regardless of which model runs downstream, and defers the same single ambiguous case. This is parity by construction visible in the instrumentation rather than inferred from scores.
