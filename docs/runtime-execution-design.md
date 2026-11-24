# Runtime Execution Manager

## Contract

shell() and python() share a server-owned execution registry and file-backed stdout/stderr. Timeout means foreground wait, not process lifetime: default 30 seconds, zero immediately backgrounds after successful spawn, positive values capped at 50 seconds, negative rejected. Foreground completion preserves existing output/error format. Background response is successful and contains only executionId and guidance to getExecution()/waitExecution(). No partial output. The independent 60-second watchdog remains unchanged.

## Architecture

Register before spawning; retain ownership across foreground/background transition. Separate status (starting/running/completed/failed/cancelling/cancelled) from background flag. Track PID, tool, timestamps, exit code, signal, output sizes and truncation. Preserve process-tree termination and Python stdin semantics. Resolve completion only after output is flushed. Handle spawn errors, timeout/exit/cancel races, and detach the foreground abort listener atomically. A foreground abort kills the process; a detached execution survives client disconnect. Socket Server owns remote executions; standalone server owns local executions. No restart recovery or cross-server sharing in v1.

## Management and output

Runtime tools: listExecutions(status?), getExecution(executionId), waitExecution(executionId, timeout?), cancelExecution(executionId), removeExecution(executionId). Wait timeout returns status, not cancellation; remove only terminal records. No interactive stdin; use PTY for that. Use read-only execution://<id>/stdout, stderr, info.json; metadata generated from registry. Integrate read/list/find/grep and Codemode, not result://. Validate IDs and paths; never expose backing paths. Use private per-server directories under ~/.local/state/terminal-toolkit/executions (platform-compatible home path). Stream output from spawn, separate stdout/stderr, no ordering guarantee between streams. Preserve existing foreground output policy.

## Limits and cleanup

Implemented limits: 16 concurrent executions, 100 MiB per execution combined output, 1 GiB aggregate, 100 completed records, 24h retention, 60s sweep. No background runtime limit. On output cap continue draining pipes and mark truncation; evict oldest completed records first, never delete active output. Foreground records not exposed to agents can be removed after response materialization. Handle disk errors without hanging or unhandled rejection. Normal server shutdown terminates managed process trees and closes files; abnormal shutdown may leave children, do not kill arbitrary reused PIDs. On first execution, reclaim marked instance directories only when owner.json identifies a PID that returns ESRCH. Retain unknown or live owners; PID reuse may defer reclamation. No attempt to kill orphan processes from a previous instance. Restrict storage permissions. No new control notification protocol.

## Delivery phases and acceptance

- Phase 0: independent watchdog (commit d42859c).
- Phase 1: internal execution registry, spawn lifecycle, file-backed output, cancellation and unit tests. No public behavior change.
- Phase 2: connect shell/python, timeout zero/default/cap, preserve foreground format, detach and cancellation race tests.
- Phase 3: management tools, definitions/descriptions, direct/socket/codemode routing, reconnect and wait/cancel tests.
- Phase 4: execution:// read-only VFS, path validation, live reads, list/find/grep and Codemode tests.
- Phase 5: limits, retention, shutdown and disk failure handling; test quotas, eviction and active-record protection.
- Phase 6: full suite, platform validation, agent guidance and README; document unverified platforms.

Validation: macOS full npm test: 189 tests, 187 passed, 2 skipped, 0 failed. Remote client reconnect across Codemode and direct MCP, headless and self-hosted socket shutdown, pagination and 50 KiB grep limits are covered. Linux, Windows/MSYS2 and Termux remain unverified. Output retention is server-local and periodic, not a durable job service.

Update NOTE.md at each milestone; commit independently reviewable changes. Do not expose incomplete public features without their required management and cleanup paths. Revisit limits only with explicit design rationale. Existing watchdog, output policy and PTY behavior remain independent.
