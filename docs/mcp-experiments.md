# MCP experiments

## MCP Events 實驗（暫停）

- [x] 選用的 `--experiment-mcp-events` 提供 `events/list`、`events/subscribe`、`events/unsubscribe` 與 `terminal.test`；訂閱持久化、Webhook Challenge 與 HTTPS 投遞已實測成功，重啟後訂閱仍保留。
- [x] HMAC-SHA256 簽章以獨立安裝的 `standardwebhooks@1.1.1` 交叉驗證一致（含 Unicode Payload）；不增加正式相依套件。
- [x] CLI `event emit terminal.test --message "..." [--subscription-id sub_...]` 可廣播或指定單筆訂閱；回傳 eventId、timestamp、逐筆 HTTP 狀態及不含機密的診斷資訊。
- 維持實驗開關，不預設啟用；暫不擴充事件種類、重試機制或修改 Payload。

2026-11-16 ChatGPT Work 端對端未成功：單筆 Webhook HTTP 200，但對話未顯示事件。不能據此確定問題位於 OpenAI 端。

## ChatGPT MCP 初始化、工具快取與指示傳遞實驗

- [x] 初步驗證 `initialize.instructions` 的 ChatGPT 行為：新增選用的 `--experiment-initialize`，每次 initialize 產生不同 `TT-INIT-XXXXXXXX` 暗號、加入回應 instructions 並記錄 stderr；實際 ChatGPT 對話能呼叫 Terminal Toolkit，但詢問暗號時無法回答。**觀察結論：不可依賴 ChatGPT 將 initialize.instructions 作為模型可遵循指示。** 使用者已確認 stderr 日誌出現暗號，且在全新 ChatGPT 對話重測仍無法取得；可確認 ChatGPT 對話未有效採用該指示，但仍無法單憑模型回應區分「整合層未傳遞」或「模型收到但未遵循」。其他 MCP Client 可另行重測。
- [x] 重構正常模式：不再提供 `initialize.instructions`；Namespace 指引移至 `src/tools/namespaceGuidance.ts`，Codemode 經 `describeNamespace()` 取得；非 Codemode 經 `tools/list` 的 Tool description 取得精簡共通指引。`--experiment-initialize` 仍獨立提供暗號測試。後續逐項 Review Namespace／Tool 描述，必要約束仍由 Server 執行。
- 區分協定規範與觀察：MCP 初始化是一般操作前的必要流程；ChatGPT 的快取、Session 生命週期與 instructions 使用方式尚待實測，不應視為已確認的實作保證。

## Codemode 探索體驗

- [x] 頂層 `codemode()` description 已揭露 `tools/core` 的 `read`、`write`、`edit`、`tools/runtime` 的 `shell`、`python` 與 PTY/Misc 分工；namespace 與工具描述也加入檔案操作優先規則。後續仍可觀察 Agent 實際選擇行為。

後續研究見 [ROADMAP](../ROADMAP.md)。
