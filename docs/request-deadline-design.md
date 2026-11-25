# Request deadline strategy

## Three safety nets

| Layer | Policy | On expiry |
| --- | --- | --- |
| Tool foreground wait | 90 seconds default and maximum | shell/python detach and return executionId; waitExecution returns current metadata |
| Request watchdog | 100 seconds | Return tool error and request cooperative cancellation |
| Tunnel Client response_timeout | Upstream supplied (observed 120 seconds) | Stop forwarding, retire request ID where safe, discard late response |

The first layer is normal flow control, not a process lifetime limit. The second is a last-resort safety deadline; the third is a transport failure boundary. Normal calls should not reach the second or third layers. Non-runtime tools without a local timeout have two safety nets. Codemode has its own default/maximum 100-second execution deadline rather than a duplicate outer watchdog.

## Ownership and timing

The MCP entrypoint owns the watchdog: headless MCP locally, Socket Client in proxy mode. Socket Server executes with the forwarded cancellation signal, without restarting the watchdog. Disconnect and cancel handling remain in place. Codemode nested tool calls retain individual watchdogs, subject to the outer Codemode cancellation signal.

Runtime foreground wait starts after execution readiness; the watchdog starts earlier. The nominal 10-second margin is not a guarantee if startup, output materialization or scheduling stalls. The watchdog requests cancellation, not proof of termination; a blocked event loop can delay timers. Detached executions are independent of the original request and can be cancelled explicitly.

## Upstream deadline

Tunnel Client derives its absolute deadline from polledAt plus response_timeout and forwards a metadata hint. Terminal Toolkit parses the hint but does not dynamically adjust its local deadlines. No Tunnel Client changes are required for this policy. At the upstream deadline minus 10 seconds (normally 110 seconds), a best-effort warning may trigger early detach for shell/python or early metadata return for waitExecution. ACK is not completion and never extends the deadline. Other tools ignore the warning. See [warning protocol](response-timeout-warning.md).

The intended margins (90/100/110/120 seconds) assume a 120-second upstream budget and negligible dispatch delay. A shorter upstream timeout or queueing can change the ordering. Avoid reaching the upstream deadline to reduce lost responses and dangling work; do not disable enforcement or rely on it for ordinary flow control.

## Response contract

Foreground success returns stdout/stderr; nonzero exit returns output and exit code with isError. Detach returns success with executionId and management guidance only. waitExecution timeout or warning returns current metadata without cancelling the job; zero polls immediately. Watchdog expiry returns a safety deadline error and requests cancellation. Tunnel timeout does not post a late response.
