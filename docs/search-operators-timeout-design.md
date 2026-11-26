# Search operators timeout and cancellation design

Status: implemented and automated regression passed on macOS (2026-11-26); deployed-service acceptance pending.

## Contract
- Applies to list, grep, find in direct MCP, Socket and Codemode paths, including execution:// and result://.
- timeout is seconds, default 30, maximum 90, zero means no operator-specific timeout (100-second watchdog still applies).
- An operator timeout returns accumulated valid results, with a conspicuous machine-readable status footer `[search-status timedOut=true incomplete=true; search stopped before completion]`; an empty partial result is not a definitive no-match.
- Normal limit and output truncation remain separate from timeout. Upstream abort and watchdog abort are cancellations, not successful partial results.
- No automatic Runtime Execution Manager handoff.

## Architecture
- Forward AbortSignal from local dispatch and socket request handler to handleExtraOperatorTool; preserve existing Codemode forwarding.
- Create an operator-local AbortController linked to upstream signal, with its own timeout timer; distinguish its timeout from parent cancellation.
- Stream rg/fd stdout into bounded incremental collectors rather than buffering the entire search (individual pending records limited to 8 MiB).
- On operator timeout terminate subprocess and await close, return collected complete records; on parent abort terminate and reject. Avoid partially decoded UTF-8 / JSON records.
- For local list use opendir and cooperative checks between entries; an in-flight filesystem operation is not preemptible. For virtual iteration check cancellation and deadline between entries/lines. CPU-bound synchronous enumeration cannot be preempted while the JS event loop is blocked; virtual execution enumeration yields every 32 executions and virtual grep every 128 lines. Snapshot creation and sorting remain synchronous.
- Maintain the existing 50 KiB output cap and result-store behavior, preserving status footer after truncation.

## Verification
- Test normal result, no match, limit and 50 KiB cap.
- Test zero/default/max/invalid timeout, pre-aborted signal, abort during subprocess, timeout with and without matches, and timeout-vs-parent-abort race.
- Test socket cancellation forwarding and Codemode paths, virtual file searches, and no leaked subprocesses.
- Run focused tests then full npm test. Record host-specific verification separately.


## Verification results (2026-11-26)

- Focused tests: 7 passed; full npm test: 204 tests, 202 passed, 2 skipped, 0 failed.
- MCP SDK integration: five consecutive runs, 20/20 local/socket and direct/Codemode grep scenarios passed. An earlier intermittent failure was not reproduced; a separate full-suite PID readiness timing failure was corrected and regression passed.
- Watchdog tested with an injected short deadline, not a real 100-second deployed request. Actual ChatGPT cancellation delivery remains unverified.
- Windows/MSYS2 acceptance and corresponding subprocess tests remain in ROADMAP.
