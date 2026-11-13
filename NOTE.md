# NOTE

Terminal Toolkit 尚未完成、值得後續追蹤的事項。已完成的實作與歷史進度以 Git 紀錄為準。

## MCP Skills 相容層

- [ ] 評估是否提供選用的 MCP Tools 相容層，例如 `listSkills()`、`getSkill(name)`，供尚未原生支援 MCP Skills Extension（SEP-2640）的 AI Client 探索、讀取 Skills。
- 應重用現有 `skills/list`、`skills/get`、`resources/read` 與外部 Skills 設定的清單、驗證及讀取邏輯；先確認 ChatGPT 對 MCP Skills 的實際支援行為，再決定預設／opt-in、Codemode 揭露及避免功能重複的方式。
- 一般 MCP Tool 讀取 `SKILL.md` 不等於原生安裝、啟用或自動觸發 Skill。

## Codemode 探索體驗

- [x] 頂層 `codemode()` description 已揭露 `tools/core` 的 `read`、`write`、`edit`、`shell` 與 PTY/Misc 分工；namespace 與工具描述也加入檔案操作優先規則。後續仍可觀察 Agent 實際選擇行為。
- [ ] P2：工具數量增加或搜尋品質不足時，評估將 `searchTools()` 的字串比對升級為 BM25；目前非必要。

## ChatGPT MCP 初始化、工具快取與指示傳遞實驗

- [ ] 驗證 ChatGPT 手動 Refresh Plugin 時是否呼叫 `tools/list` 並快取工具定義，以及後續新對話、同一對話多次工具呼叫時是否重新請求；以 Tunnel Client 的 MCP JSON-RPC Trace 比對 `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 與連線識別。
- [x] 初步驗證 `initialize.instructions` 的 ChatGPT 行為：新增選用的 `--experiment-initialize`，每次 initialize 產生不同 `TT-INIT-XXXXXXXX` 暗號、加入回應 instructions 並記錄 stderr；實際 ChatGPT 對話能呼叫 Terminal Toolkit，但詢問暗號時無法回答。**觀察結論：不可依賴 ChatGPT 將 initialize.instructions 作為模型可遵循指示。** 使用者已確認 stderr 日誌出現暗號，且在全新 ChatGPT 對話重測仍無法取得；可確認 ChatGPT 對話未有效採用該指示，但仍無法單憑模型回應區分「整合層未傳遞」或「模型收到但未遵循」。其他 MCP Client 可另行重測。
- [ ] 比較 `tools/list` 工具 `description` 的指示效果：手動 Refresh Plugin 後於新舊對話測試固定識別字串，與 initialize.instructions 結果對照。
- [x] 重構正常模式：不再提供 `initialize.instructions`；Namespace 指引移至 `src/tools/namespaceGuidance.ts`，Codemode 經 `describeNamespace()` 取得；非 Codemode 經 `tools/list` 的 Tool description 取得精簡共通指引。`--experiment-initialize` 仍獨立提供暗號測試。後續逐項 Review Namespace／Tool 描述，必要約束仍由 Server 執行。
- [ ] 後續評估在 `codemode()` 回傳探索提示／版本或狀態摘要，並以實際工具呼叫統計驗證 Agent 是否使用；避免每次輸出大量固定指示。
- [ ] 研究 `tools/list` 動態揭露的可行性：ChatGPT 可能只在 Plugin 更新時快取工具定義，執行階段即使重複 `initialize` 也未必重新取得工具清單；驗證 `notifications/tools/list_changed` 的支援情況後，再決定是否採用動態清單或固定入口搭配 Codemode `searchTools()` 等執行期探索機制。
- 區分協定規範與觀察：MCP 初始化是一般操作前的必要流程；ChatGPT 的快取、Session 生命週期與 instructions 使用方式尚待實測，不應視為已確認的實作保證。
