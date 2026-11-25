# Changelog

Notable changes to Terminal Toolkit are documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Dates and release boundaries follow Git tags.

## [Unreleased]

## [0.7.0] - 2026-11-25

### Added
- Runtime Execution Manager for background shell and Python jobs, live stdout/stderr, status, waiting, cancellation, cleanup and bounded retention.
- Native Python execution and runtime tool namespace.
- Read-only `execution://` output paths and `result://` virtualization for oversized standard MCP responses.
- Namespaced Skills discovery in Codemode and optional standard MCP compatibility discovery, including Skill frontmatter metadata.
- System information, PTY input/output activity timestamps and shared tool usage statistics.
- Per-tool safety watchdog, response deadline observability and opt-in cancellation tracing.
- Termux notification and toast support, and MCP tool safety annotations.

### Changed
- Core operators, including `list`, `grep`, and `find`, are enabled by default; legacy operator flags are no-ops.
- Shell and Python timeout now controls foreground waiting rather than process lifetime; zero or expiry detaches execution.
- Agent guidance favors background runtime execution for long non-interactive work and PTY for interactive or user-visible work.
- Codemode text output limit is 16 KiB; standard MCP output virtualization is separate from Codemode and Skill discovery.
- Standard MCP tool descriptions carry standalone guidance; Codemode separates discovery descriptions, instructions and namespace guidance. Normal operation does not depend on initialize instructions.

### Fixed
- Serialize socket ownership claims across processes and recover claims left by dead owners.
- Restrict startup Skills diagnostics to MCP mode and avoid resource digest scans during startup.
- Socket reconnection and server takeover after disconnect, including stale socket paths on macOS.
- Tool statistics propagation across socket requests and cancellation/deadline handling.
- Operator default and discovery test alignment.

## [0.6.0] - 2026-11-06

### Added
- Interactive socket clients can attach to specific PTY sessions and detach without terminating the server.
- Connection count and session lifecycle notifications over the interactive socket.
- Socket protocol capability negotiation through the optional `hello` request.
- Scoped custom-event subscriptions and publishing, with topic validation, payload limits, subscription caps, rate limiting, and slow-subscriber protection.
- Codemode tool and discovery usage statistics.
- External Skills configuration and startup loading diagnostics.
- Narrow-terminal startup banner layout.

### Changed
- Extracted socket protocol and event-broker logic into dedicated modules.
- Process socket tool requests concurrently so long-running calls do not block later NDJSON frames.
- Updated Terminal Toolkit branding and MCP startup configuration.

### Fixed
- Cancel and disconnect now clean up in-flight requests and connection-owned event subscriptions.
- Duplicate in-flight request IDs are rejected.
- Asynchronous PTY attachment is invalidated on detach or disconnect; input and resize commands require a completed attachment.
- Interactive socket path conflicts and attachment lifecycle edge cases.

## [0.5.1]

### Fixed
- Hardened stdio shutdown and recording stop metadata.
- Corrected Claude Code configuration paths and npm invocation examples.
- Restricted npm package contents with an explicit file allowlist.

## [0.5.0]

For earlier changes, consult the Git history and tagged releases. Older
versions are not retroactively summarized here to avoid attributing changes
to the wrong release.

[Unreleased]: https://github.com/louisje/terminal-toolkit/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/louisje/terminal-toolkit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/louisje/terminal-toolkit/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/louisje/terminal-toolkit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/louisje/terminal-toolkit/releases/tag/v0.5.0
