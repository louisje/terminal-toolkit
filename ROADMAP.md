# ROADMAP

記錄未來規劃、待辦、研究及暫緩事項，不代表已承諾時程。隨開發進程即時滾動更新，調整優先順序與剩餘需求，主動淘汰已完成、失效或被取代的事項；歷史由 Git 保存。開始實作時標記已啟動，當前階段與交接資訊以 [NOTE.md](NOTE.md) 為準。維護方式見 [Development workflow](docs/development-workflow.md)。

## Planned

### Skills 探索分頁

- [ ] 為 `searchSkills()`、`describeSkill()` 設計分頁及容量控制；保留完整 metadata、穩定排序、過濾與逐頁取得能力，處理多位元組文字、單筆過大及邊界值。現行輸出策略見 [Output policy](docs/output-policy.md)。

### list / grep / find 逾時與取消

- [ ] 為 `list()`、`grep()`、`find()` 增加對外 `timeout` 參數，統一秒數單位，明確定義預設值、上限及零值；與既有 100 秒 Tool Watchdog 保持合理裕度。
- [ ] 工具自身逾時採部分結果（partial results）策略：停止搜尋或列舉，保留並回傳截至逾時已取得的有效結果，不因逾時而丟棄結果；即使尚未取得任何結果，也必須明確告知 AI agent 已逾時、操作尚未完成，不能將部分結果或空結果誤認為完整結果。逾時狀態應與正常完成、輸出容量限制及筆數限制明確區分，且在輸出截斷或虛擬檔案回覆時仍須可辨識。
- [ ] 將 `AbortSignal` 貫穿工具分派與底層實作，涵蓋本地及 Socket 路徑、Codemode／非 Codemode、實體與虛擬檔案操作；取消時停止目錄遍歷、搜尋及相關子程序（`rg`、`fd`），清理資源，避免只結束工具回覆而留下工作繼續執行。
- [ ] 驗證工具自身逾時、Watchdog 逾時、上游取消、正常完成及競態情況；確認不影響既有輸出限制及 Runtime 背景執行機制。
- 工具自身逾時以停止操作並回傳部分結果為原則，不自動轉入背景；預設值、上限及零值語意待設計階段確認。現行安全期限見 [Request deadline strategy](docs/request-deadline-design.md)。

## Backlog

### VFS 共用抽象與測試

- [ ] 建立共用 Virtual File System（VFS）抽象層，統一虛擬路徑解析、檔案與目錄存取及權限判斷；保留既有 `builtin://skills/...` 路徑相容性，並支援未來其他虛擬檔案來源。
- [ ] 確保 `read()`、`list()`、`grep()`、`find()` 可操作虛擬檔案／目錄：讀取、列目錄、搜尋內容及路徑；搜尋結果使用虛擬路徑，不應直接暴露背後實體路徑。
- [ ] 預留 `write()`、`edit()` 的 VFS 寫入／編輯介面及來源權限模型；目前內建 Skills 維持唯讀，未來僅對明確允許寫入的虛擬來源開放修改。
- [ ] 補齊跨工具測試：虛擬路徑、目錄與檔案、搜尋、路徑穿越防護、唯讀限制及實體檔案操作相容性。

### Runtime 跨平台驗證

- [ ] Linux、Windows/MSYS2、Termux 實機程序樹終止、檔案權限及異常退出行為。

### Codemode 大型輸出

- [ ] 研究 Codemode text() 超限解方，避免 read(result://...) 再產生 result:// 的循環；現行策略見 [輸出策略](docs/output-policy.md)。

## Research

### Runtime / Python 後續擴充

- [ ] 執行環境設定與可觀測性：Python executable、工作目錄、環境變數、虛擬環境探測及結構化執行結果。
- [ ] 結構化結果與大型輸出：JSON、表格、圖片、檔案及 VFS 整合。
- [ ] Persistent Python Runtime：研究對話隔離、常駐 interpreter、生命週期、序列化及資源上限；先驗證可靠的對話識別。
- [ ] 研究 CPU、記憶體及網路資源限制。
- [ ] 研究 Python 與 Codemode 的共用生命週期管理及其他語言 Runtime；優先保留語言專屬介面。

### Codemode 探索與持續狀態

- [ ] P2：工具數量增加或搜尋品質不足時，評估將 `searchTools()` 的字串比對升級為 BM25；目前非必要。
- [ ] 研究依 ChatGPT 對話識別保留 Codemode QuickJS 全域狀態：先驗證 `RequestContext`／MCP `_meta` 能否穩定區分同一對話的多次 `tools/call`，以及 `@earendil-works/pi-codemode` 是否支援重複 `execute()` 並保留 JavaScript Context。若可行，評估以識別雜湊隔離每個對話的 Sandbox、同一對話呼叫序列化、閒置逾時回收、錯誤／取消時重建；無法可靠識別時維持每次獨立 Sandbox。此項僅供研究，暫不改變現行 `--codemode` 行為。

### MCP Skills 相容性

- [ ] 持續驗證 AI Client 對原生 MCP Skills Extension 的支援；若可用，評估停用現有選用的探索相容層，避免重複介面。

### ChatGPT MCP 初始化、工具快取與指示傳遞

- [ ] 驗證 ChatGPT 手動 Refresh Plugin 時是否呼叫 `tools/list` 並快取工具定義，以及後續新對話、同一對話多次工具呼叫時是否重新請求；以 Tunnel Client 的 MCP JSON-RPC Trace 比對 `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 與連線識別。
- [ ] 比較 `tools/list` 工具 `description` 的指示效果：手動 Refresh Plugin 後於新舊對話測試固定識別字串，與 initialize.instructions 結果對照。
- [ ] 後續評估在 `codemode()` 回傳探索提示／版本或狀態摘要，並以實際工具呼叫統計驗證 Agent 是否使用；避免每次輸出大量固定指示。
- [ ] 研究 `tools/list` 動態揭露的可行性：ChatGPT 可能只在 Plugin 更新時快取工具定義，執行階段即使重複 `initialize` 也未必重新取得工具清單；驗證 `notifications/tools/list_changed` 的支援情況後，再決定是否採用動態清單或固定入口搭配 Codemode `searchTools()` 等執行期探索機制。
- 區分協定規範與觀察：MCP 初始化是一般操作前的必要流程；ChatGPT 的快取、Session 生命週期與 instructions 使用方式尚待實測，不應視為已確認的實作保證。

已完成的實驗結論見 [MCP 實驗紀錄](docs/mcp-experiments.md)。

### MCP Response Deadline

- [ ] 研究依上游 deadline 動態調整本地等待與 watchdog，保留回覆時間裕度。
- [ ] 補強各工具協作式取消、寫入原子性及重試冪等性；保護 Primary Session。
- [ ] 研究工具執行成功與回覆交付成功的獨立觀測及統計。
- [ ] 在 Client 支援情況改變時重驗 MCP cancellation 端對端行為。

現行策略見 [Request deadline strategy](docs/request-deadline-design.md)。

## Deferred

### MCP Events

- [ ] 待 ChatGPT MCP Events 功能更新再重測端對端投遞。
- 維持實驗開關，不預設啟用；暫不擴充事件種類、重試機制或修改 Payload。

既有實驗能力及驗證結果見 [MCP 實驗紀錄](docs/mcp-experiments.md)。
