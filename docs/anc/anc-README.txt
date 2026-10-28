ANCILLARY FILES
Decompose, Don't Expand: Capability-Independent AI Systems by Construction
Tejaswi Gowda, Arizona State University

These two files contain the data behind every table and figure in the paper.
Every number in Tables 1-4 is derived from eval-results.jsonl; nothing was
transcribed by hand.

--------------------------------------------------------------------------
FILES
--------------------------------------------------------------------------

eval-results.jsonl   3,382 records, JSON Lines (one JSON object per line)
RESULTS.md           the full generated tables, including cells not shown
                     in the paper

--------------------------------------------------------------------------
eval-results.jsonl SCHEMA
--------------------------------------------------------------------------

Two record kinds, distinguished by the "kind" field.

"run" (38 records) -- one per evaluation run.

  run_id                 unique id
  model_tag              e.g. qwen2.5-coder:1.5b, claude-opus-5-5
  parameter_size         as reported by the server
  condition              bare | scaffolded | constrained | host-resolved
  repeat                 repeat index within that (model, condition) cell
  status                 harness loop outcome
  excluded               true for 2 of the 38 runs (see EXCLUSIONS below)
  exclusion_reason       why, when excluded is true
  started, finished      timestamps
  rows, calls            counts
  failure_kinds          distribution over wrong | empty | parse_error |
                         exception | timeout
  host_stats             host-resolution counters (selector and operation
                         assignment, deferrals)
  model_digest           sha256 of the served model
  quantization_level     Q4_K_M for all local checkpoints
  server, server_context runtime and effective context length
  path                   API path actually used
  decode                 temperature, max_tokens, and whether temperature
                         was forwarded
  origin                 browser origin the run was executed from
  max_prompt_tokens_observed
  sut_commit             commit of the system under test
  scorer_sha256          hash of the scoring code
  provenance_errors      provenance capture problems, if any

"row" (3,344 records) -- one per fixture x task x run.

  run_id                 joins to the run record
  model, condition, repeat
  task                   op-selection | selector-resolution |
                         arg-extraction | multi-op | labeling
  id                     fixture id, stable across models and conditions
  score                  boolean, scored at the resolved-node level
  failure_kind           null when score is true
  call_ids               the model call(s) that produced this row
  excluded               inherited from the run

NOTE ON SPELLING: the harness writes the task name as "labeling"; the paper
writes "labelling". The name was deliberately NOT renamed in the harness,
because the harness source is hashed into scorer_sha256 and renaming it
would have invalidated comparison with runs captured earlier. The mapping is
applied in the table generator only.

--------------------------------------------------------------------------
EXCLUSIONS
--------------------------------------------------------------------------

2 of the 38 runs are marked excluded = true. Both reported a completed
harness loop while the majority of their API calls raised exceptions, so
the completion status was not meaningful. Both have clean replacement
repeats, which are included. The 36 analysed runs are those with
excluded = false.

The excluded records are retained in this file rather than deleted, so the
exclusion is visible and checkable rather than asserted.

--------------------------------------------------------------------------
PROVENANCE
--------------------------------------------------------------------------

System under test:  strata-editor, commits 888d97e and 6b7cbb7
Scorer:             sha256:43698355... identical for every run reported here
Local models:       Qwen2.5-Coder-Instruct at 0.5B, 1.5B, 3B, 7B, 14B,
                    served by Ollama at Q4_K_M, temperature=0
Frontier models:    claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5,
                    claude-fable-5-1, via the Anthropic API

The sweep spans two commits of the system under test. The scorer hash is
identical across all runs, so scoring is comparable, but the harness is not
byte-identical across the whole sweep. This is stated in the paper's
Limitations section and is repeated here so it is not missed.

temperature=0 is forwarded for the local models but is NOT forwarded on the
Anthropic client path, so the frontier columns are sampled rather than
greedy. This is recorded per run in decode.temperature_forwarded.

--------------------------------------------------------------------------
REPRODUCING THE TABLES
--------------------------------------------------------------------------

Filter to excluded == false, then group row records:

  Table 1  condition == "scaffolded",   group by (model, task)
  Table 2  group by (condition, model), overall score; four models only
  Table 3  condition == "host-resolved", group by (model, task)
  Table 4  condition == "host-resolved"; join rows on (task, id) between
           each model and the 0.5B checkpoint; count matching score values

Scores are means of the boolean score field. Where more than one repeat
exists the mean across repeats is reported.

Full call-level capture -- prompts as sent, raw model responses, usage and
latency -- is larger than is appropriate for ancillary files and is not
included here.
