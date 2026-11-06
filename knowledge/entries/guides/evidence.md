# Use evidence for an individual decision

Start with the athlete's current goals, experience, constraints and actual training. Identify the specific decision before collecting more research. The local library is a selected reference, not an exhaustive or automatically updated evidence service.

```sh
atlas knowledge list
atlas knowledge search --query '{"q":"hypertrophy volume","limit":5}'
atlas knowledge get volume
```

Search is case-insensitive keyword matching and requires every term. Use fewer terms when there are no matches. Results include library version and entry metadata; `get` supplies Markdown and resolved bibliography. `research`, `practice`, and `program` entries have different authority. Version and review date identify content, not confidence or the athlete's review date.

## Route the question

| Decision | Retrieve with `atlas knowledge get ID` |
|---|---|
| Intake, baseline, relevant symptoms/restrictions | `assessment-and-readiness` |
| Feasible routine, barriers and recovery context | `adherence-and-recovery` |
| Aerobic work or mixed training | `aerobic-conditioning`, `concurrent-training` |
| Resistance training dose | `volume`, `frequency`, `load-and-repetitions` |
| Effort and recoverable set quality | `proximity-to-failure`, `rest` |
| Movement/setup fit | `exercise-selection` |
| Adjustment or compressed schedule | `progression`, `deloads`, `time-efficient-training` |
| Named program context | `programs/min-max`, `programs/muscle-ladder` |
| Dated source checks behind the coaching skills | `evidence/2026-10-05-failure-rir`, `evidence/2026-10-12-rest-recovery-time-efficiency`, `evidence/2026-10-12-coaching-source-checks`, `evidence/2026-10-12-mobility-stretching-yoga` |
| Unresolved questions worth checking before a firm rule | `research/open-questions` |

Entries tagged `older-summary` (IDs `research/YYYY-MM-DD-topic`) are brief historical pointers imported from an earlier research collection. Their sources and bibliographic details were not re-checked. Use them to find a topic or a source to read; when they disagree with a topic entry or a dated `evidence/` check, the checked entry wins. Repeated pointers to the same study are not independent support.

Read a named program's actual authorized prescription separately. Program summaries are not complete commercial schedules and should not be used to fabricate missing workouts. Use the relevant research entry to understand a possible tradeoff, rather than treating a program convention as universal evidence.

## Translate findings honestly

Distinguish three things in the recommendation: what a source found; what the current program explicitly asks for; and what you infer for this athlete. Check studied population, outcome, intervention and uncertainty. Reviews may reuse the same trials; do not count them as independent confirmations, and acknowledge unverified overlap when trial lists are unavailable. An average benefit does not identify a personal optimum; a short individual trend does not establish a general causal rule. Keep exact tested values separate from practical starting heuristics.

Source `access` records whether an abstract, full-text sections, or secondary notes were reviewed. Do not imply full-text verification from a title, abstract, or book summary. Use returned bibliography links when citing research to the user. If the answer requires evidence outside the library, use an available research capability and identify the sources and access level; Atlas knowledge commands do not browse or fetch papers.

Explain a concrete, proportionate recommendation tied to the athlete's constraint, including what would prompt reassessment. When useful, record the relevant entry/library version with the coaching rationale. Preserve source dates and distinguish current athlete facts from inference in durable notes. Updating the bundled library or finding a newer paper does not itself authorize changing a saved plan.

For implementation, retrieve `guides/review-adaptation` and `guides/safe-mutations`. Keep practical coaching useful: uncertainty should qualify the decision where it matters, rather than create a generic disclaimer or repeated approval gate for already authorized work.
