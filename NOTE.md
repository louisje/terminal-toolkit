# NOTE

Terminal Toolkit 尚未完成、值得後續追蹤的事項。已完成的實作與歷史進度以 Git 紀錄為準。


## MCP Events 實驗（暫停）

- [x] 選用的 `--experiment-mcp-events` 提供 `events/list`、`events/subscribe`、`events/unsubscribe` 與 `terminal.test`；訂閱持久化、Webhook Challenge 與 HTTPS 投遞已實測成功，重啟後訂閱仍保留。
- [x] HMAC-SHA256 簽章以獨立安裝的 `standardwebhooks@1.1.1` 交叉驗證一致（含 Unicode Payload）；不增加正式相依套件。
- [x] CLI `event emit terminal.test --message "..." [--subscription-id sub_...]` 可廣播或指定單筆訂閱；回傳 eventId、timestamp、逐筆 HTTP 狀態及不含機密的診斷資訊。
- [ ] **端對端仍未成功**：2026-11-16 在 ChatGPT Work 建立新工作與新訂閱，單筆 Webhook 回 HTTP 200，但 Work 對話未顯示事件；HTTP 200 只表示端點接受請求，尚無證據確定問題位於 OpenAI 端。後續待 ChatGPT MCP Events 功能更新再重測。
- 維持實驗開關，不預設啟用；暫不擴充事件種類、重試機制或修改 Payload。

## MCP Skills 相容層

- [ ] 評估是否提供選用的 MCP Tools 相容層，例如 `listSkills()`、`getSkill(name)`，供尚未原生支援 MCP Skills Extension（SEP-2640）的 AI Client 探索、讀取 Skills。
- 應重用現有 `skills/list`、`skills/get`、`resources/read` 與外部 Skills 設定的清單、驗證及讀取邏輯；先確認 ChatGPT 對 MCP Skills 的實際支援行為，再決定預設／opt-in、Codemode 揭露及避免功能重複的方式。
- 一般 MCP Tool 讀取 `SKILL.md` 不等於原生安裝、啟用或自動觸發 Skill。

## 虛擬檔案系統（VFS）待辦

- [ ] 建立共用 Virtual File System（VFS）抽象層，統一虛擬路徑解析、檔案與目錄存取及權限判斷；保留既有 `builtin://skills/...` 路徑相容性，並支援未來其他虛擬檔案來源。
- [ ] 確保 `read()`、`list()`、`grep()`、`find()` 可操作虛擬檔案／目錄：讀取、列目錄、搜尋內容及路徑；搜尋結果使用虛擬路徑，不應直接暴露背後實體路徑。
- [ ] 預留 `write()`、`edit()` 的 VFS 寫入／編輯介面及來源權限模型；目前內建 Skills 維持唯讀，未來僅對明確允許寫入的虛擬來源開放修改。
- [ ] 補齊跨工具測試：虛擬路徑、目錄與檔案、搜尋、路徑穿越防護、唯讀限制及實體檔案操作相容性。

## Codemode 探索體驗

- [x] 頂層 `codemode()` description 已揭露 `tools/core` 的 `read`、`write`、`edit`、`shell` 與 PTY/Misc 分工；namespace 與工具描述也加入檔案操作優先規則。後續仍可觀察 Agent 實際選擇行為。
- [ ] P2：工具數量增加或搜尋品質不足時，評估將 `searchTools()` 的字串比對升級為 BM25；目前非必要。
- [ ] 研究依 ChatGPT 對話識別保留 Codemode QuickJS 全域狀態：先驗證 `RequestContext`／MCP `_meta` 能否穩定區分同一對話的多次 `tools/call`，以及 `@earendil-works/pi-codemode` 是否支援重複 `execute()` 並保留 JavaScript Context。若可行，評估以識別雜湊隔離每個對話的 Sandbox、同一對話呼叫序列化、閒置逾時回收、錯誤／取消時重建；無法可靠識別時維持每次獨立 Sandbox。此項僅供研究，暫不改變現行 `--codemode` 行為。

## ChatGPT MCP 初始化、工具快取與指示傳遞實驗

- [ ] 驗證 ChatGPT 手動 Refresh Plugin 時是否呼叫 `tools/list` 並快取工具定義，以及後續新對話、同一對話多次工具呼叫時是否重新請求；以 Tunnel Client 的 MCP JSON-RPC Trace 比對 `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 與連線識別。
- [x] 初步驗證 `initialize.instructions` 的 ChatGPT 行為：新增選用的 `--experiment-initialize`，每次 initialize 產生不同 `TT-INIT-XXXXXXXX` 暗號、加入回應 instructions 並記錄 stderr；實際 ChatGPT 對話能呼叫 Terminal Toolkit，但詢問暗號時無法回答。**觀察結論：不可依賴 ChatGPT 將 initialize.instructions 作為模型可遵循指示。** 使用者已確認 stderr 日誌出現暗號，且在全新 ChatGPT 對話重測仍無法取得；可確認 ChatGPT 對話未有效採用該指示，但仍無法單憑模型回應區分「整合層未傳遞」或「模型收到但未遵循」。其他 MCP Client 可另行重測。
- [ ] 比較 `tools/list` 工具 `description` 的指示效果：手動 Refresh Plugin 後於新舊對話測試固定識別字串，與 initialize.instructions 結果對照。
- [x] 重構正常模式：不再提供 `initialize.instructions`；Namespace 指引移至 `src/tools/namespaceGuidance.ts`，Codemode 經 `describeNamespace()` 取得；非 Codemode 經 `tools/list` 的 Tool description 取得精簡共通指引。`--experiment-initialize` 仍獨立提供暗號測試。後續逐項 Review Namespace／Tool 描述，必要約束仍由 Server 執行。
- [ ] 後續評估在 `codemode()` 回傳探索提示／版本或狀態摘要，並以實際工具呼叫統計驗證 Agent 是否使用；避免每次輸出大量固定指示。
- [ ] 研究 `tools/list` 動態揭露的可行性：ChatGPT 可能只在 Plugin 更新時快取工具定義，執行階段即使重複 `initialize` 也未必重新取得工具清單；驗證 `notifications/tools/list_changed` 的支援情況後，再決定是否採用動態清單或固定入口搭配 Codemode `searchTools()` 等執行期探索機制。
- 區分協定規範與觀察：MCP 初始化是一般操作前的必要流程；ChatGPT 的快取、Session 生命週期與 instructions 使用方式尚待實測，不應視為已確認的實作保證。
