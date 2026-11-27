# Conversation working memory

`memory://scratchpad.md` is an optional, mutable Markdown working memory for the agent, separate from durable project documentation. The built-in scratchpad Skill provides usage guidance; no fixed document schema is required.

## Interface and isolation

Use read/write/edit on the exact file path, list/find on `memory://`, and grep on the file or root. Read uses the normal range, metadata, timeout and output policy. Write replaces the whole file; edit uses the existing exact replacement contract. Missing files are created by write. An empty write clears content.

The store lives in the process executing core operators (the Socket Server in socket mode). Requests are scoped by the provider, organization, subject and conversation fingerprints in RequestContext; missing conversation identity fails closed. No identifier is accepted from tool arguments. Socket clients forward RequestContext; their fingerprint key must remain stable for continuity across client restarts (configure TERMINAL_TOOLKIT_IDENTITY_KEY if needed). The store is not an authorization boundary against clients with unrestricted shell access or trusted socket access.

## Lifecycle

Initial defaults: one file per conversation, 16 KiB UTF-8 per file, 256 conversations, 24 hours idle expiration (lazy pruning). New entries are rejected at capacity rather than evicting active work. Server restart clears all entries. No disk persistence. The limits are implementation defaults, not protocol requirements.

Do not store secrets: tool arguments and responses may appear in MCP trace logs. Conversation identity is derived from OpenAI metadata; historical logs show stable distinct identifiers for concurrent conversations and across days, but branch/reconnect behavior still requires live verification.

## Verification

Unit coverage checks concurrent scopes, core operations, path rejection, missing identity and byte limits. MCP SDK integration tests pass for standalone and socket modes, both direct and Codemode, including two distinct identities and anonymous rejection. Live ChatGPT isolation after deployment remains to be verified.

## Conversation tool statistics

`getToolStat({scope: "conversation"})` reports the current request identity's
tool and discovery counters. The default `scope: "global"` retains existing
process-wide behavior. Both scopes are updated together at the MCP endpoint,
including Codemode calls. Socket MCP clients own their statistics; they do not
aggregate across endpoint processes. Anonymous calls contribute only globally.

Conversation counters are process-local, expire lazily after 24 hours idle
(excluding active calls), and support up to 256 identities. At capacity, new
identities contribute only globally and scoped queries fail explicitly.
The `since` timestamp describes the retained statistics window, not the
creation time of the ChatGPT conversation. Discovery query text is retained
under the existing per-scope query limits.
