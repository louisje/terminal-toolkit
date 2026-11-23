# NOTE

Terminal Toolkit 尚未完成、值得後續追蹤的事項。已完成的實作與歷史進度以 Git 紀錄為準。


## MCP Events 實驗（暫停）

- [x] 選用的 `--experiment-mcp-events` 提供 `events/list`、`events/subscribe`、`events/unsubscribe` 與 `terminal.test`；訂閱持久化、Webhook Challenge 與 HTTPS 投遞已實測成功，重啟後訂閱仍保留。
- [x] HMAC-SHA256 簽章以獨立安裝的 `standardwebhooks@1.1.1` 交叉驗證一致（含 Unicode Payload）；不增加正式相依套件。
- [x] CLI `event emit terminal.test --message "..." [--subscription-id sub_...]` 可廣播或指定單筆訂閱；回傳 eventId、timestamp、逐筆 HTTP 狀態及不含機密的診斷資訊。
- [ ] **端對端仍未成功**：2026-11-16 在 ChatGPT Work 建立新工作與新訂閱，單筆 Webhook 回 HTTP 200，但 Work 對話未顯示事件；HTTP 200 只表示端點接受請求，尚無證據確定問題位於 OpenAI 端。後續待 ChatGPT MCP Events 功能更新再重測。
- 維持實驗開關，不預設啟用；暫不擴充事件種類、重試機制或修改 Payload。

## In-Memory Result Store 套用範圍

- **套用 `result://`**：一般 MCP 工具（例如 `shell()`、`python()`、`grep()`、`list()`、`find()`、PTY／misc 工具等）每個超過 16 KiB 的文字回覆，以及 Codemode 的 `text()` 輸出。統一由 `limitResponseForTool()`／`limitToolResponse()` 控制；未列入排除名單的新工具預設套用。
- **暫不套用 `result://`**：`searchSkills()`、`describeSkill()`、`read()`。超過 16 KiB 仍維持原本的抑制訊息，不建立記憶體結果；Skills 探索日後另採分頁或容量控制方案。
- **不經 Result Store**：Codemode 的 `return` 值不受 `text()` 的 16 KiB 限制；非文字 content 與 `structuredContent` 不轉換。
- 上述規則同時適用於直接 MCP Server 與 Socket MCP Client；新增或更改工具時，需同步檢查這份套用／排除清單與測試。

## MCP Skills 相容層

- [ ] **`searchSkills()` 分頁與輸出容量控制**：目前應急版只回傳 `name`、完整 `description` 與 `total`，`describeSkill()` 保留完整 metadata。實測 50 筆為 15,845 bytes，接近 16 KiB text block 限制；新增 Skills 後可能再次超限。後續設計 `offset`／`cursor` 等分頁參數及 `nextCursor`／`hasMore`，保留現有 `query`、`name`、`limit` 語意；按實際 UTF-8 JSON bytes 預留封裝空間並限制每頁結果，避免超限時整個 text block 被抑制。需保證排序穩定、可逐頁取完、過濾與分頁一致，並測試多位元組 description、單筆過大、空結果、邊界值與新增 Skills 的情況。

- [ ] 評估是否提供選用的 MCP Tools 相容層，例如 `listSkills()`、`getSkill(name)`，供尚未原生支援 MCP Skills Extension（SEP-2640）的 AI Client 探索、讀取 Skills。
- 應重用現有 `skills/list`、`skills/get`、`resources/read` 與外部 Skills 設定的清單、驗證及讀取邏輯；先確認 ChatGPT 對 MCP Skills 的實際支援行為，再決定預設／opt-in、Codemode 揭露及避免功能重複的方式。
- 一般 MCP Tool 讀取 `SKILL.md` 不等於原生安裝、啟用或自動觸發 Skill。

## 虛擬檔案系統（VFS）待辦

- [ ] 建立共用 Virtual File System（VFS）抽象層，統一虛擬路徑解析、檔案與目錄存取及權限判斷；保留既有 `builtin://skills/...` 路徑相容性，並支援未來其他虛擬檔案來源。
- [ ] 確保 `read()`、`list()`、`grep()`、`find()` 可操作虛擬檔案／目錄：讀取、列目錄、搜尋內容及路徑；搜尋結果使用虛擬路徑，不應直接暴露背後實體路徑。
- [ ] 預留 `write()`、`edit()` 的 VFS 寫入／編輯介面及來源權限模型；目前內建 Skills 維持唯讀，未來僅對明確允許寫入的虛擬來源開放修改。
- [ ] 補齊跨工具測試：虛擬路徑、目錄與檔案、搜尋、路徑穿越防護、唯讀限制及實體檔案操作相容性。

## Runtime / Python 後續擴充方向

目前 `tools/runtime` 提供 `shell()` 與 `python()`；`python()` 使用獨立 `python3` 子程序、stdin 傳入程式碼，不保留跨呼叫狀態。以下均為研究／待辦，非已承諾的介面。

- [ ] **V2：執行環境設定與可觀測性**：支援指定 Python executable、工作目錄及環境變數；評估專案 `.venv`、uv、Conda 與跨平台 Python 探測。回傳明確的 exit code、stdout、stderr、逾時／取消狀態，避免混合輸出造成誤判；不應自動安裝套件或擅自改變環境。
- [ ] **V3：結構化結果與大型輸出**：研究 JSON、表格／DataFrame、圖片、檔案等輸出型別，以及類似 Jupyter 最後運算式的結果擷取；避免任意物件序列化造成安全與相容問題。超過 MCP 單次輸出限制時，將結果存入共用 VFS，以虛擬路徑／識別碼回傳，供 `read()` 等工具分段存取；規劃容量、存活期限及清理策略。
- [ ] **V4：Persistent Python Runtime**：研究跨呼叫保留 globals、import 與記憶體物件的常駐 Interpreter／Kernel；支援 runtimeId、建立／重設／關閉、閒置逾時回收及錯誤恢復。先驗證 `RequestContext`／`openai/subject` 雜湊能否可靠區分對話；若無法可靠識別，維持獨立 Process，避免不同 Agent／對話共享狀態。評估同一 Runtime 的執行序列化與資源上限。
- [ ] **V5：長時間任務與資源管理**：背景執行、taskId、進度與部分輸出查詢、取消、結果保存；研究與現有 PTY／程序樹終止／Sandbox 機制共用，並評估 CPU、記憶體、檔案及網路權限限制。注意 MCP response deadline 不等於工具應被強制終止。
- [ ] **共用 Runtime 架構**：研究 Python Persistent Runtime 與 Codemode QuickJS 持續狀態能否共用 Session 身分、生命週期、隔離與回收管理。`tools/runtime` 未來可加入 JavaScript、Ruby 等獨立工具，但目前不急於抽象成 `execute({language,code})`；優先保留語言專屬介面、共用底層程序管理。
- 建議順序：先完善獨立 Process 的執行環境與回覆語意，再結合 VFS 解決大型輸出；對話隔離可驗證後才考慮持續狀態，最後擴充背景任務與多語言 Runtime。

## Codemode 探索體驗

- [x] 頂層 `codemode()` description 已揭露 `tools/core` 的 `read`、`write`、`edit`、`tools/runtime` 的 `shell`、`python` 與 PTY/Misc 分工；namespace 與工具描述也加入檔案操作優先規則。後續仍可觀察 Agent 實際選擇行為。
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

## MCP Response Deadline 後續待辦（第二階段）

- [ ] 研究 Deadline 到期時的工具取消策略；區分回覆有效期限與工具執行期限，不得直接將前者視為強制停止指令。
- [ ] 對 read/find/grep 等唯讀工具評估協作式取消；對 write/edit 考慮原子性與部分完成；對 shell/type/codemode 特別保護 Primary Session，避免逾時直接送 Ctrl+C 或殺死持續工作的程序。
- [ ] 研究 MCP 取消通知、Socket AbortSignal 傳遞、逾時後狀態查詢及重試冪等性；先實測再啟用自動取消。
- [ ] 驗證 Tunnel Client 的 `response_timeout` 逾時能否被 Terminal Toolkit 察覺：獨立 MCP 連線可能因關閉而觸發中斷；共用 stdio 會保留連線、退休逾時 JSON-RPC ID 並丟棄遲到的 response，不保證通知下游；若工具已完成但 response POST 逾時，Terminal Toolkit 通常無從得知。以端對端測試釐清是否送出 MCP `notifications/cancelled`、SDK 是否轉成 `AbortSignal`，以及 Socket 路徑是否傳遞取消。
- [ ] 評估 `getToolStat()` 的語意：目前成功代表 Terminal Toolkit 工具執行成功，不代表 Tunnel Client 已成功轉送 response；研究如何另行觀測逾時放棄、下游取消與完成後回覆被丟棄，避免將未確認的交付狀態誤記為工具失敗。
