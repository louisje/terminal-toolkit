# Output policy

## In-Memory Result Store 套用範圍

- **套用 `result://`**：一般非 Codemode MCP 工具（例如 `shell()`、`python()`、`grep()`、`list()`、`find()`、PTY／misc 工具等）每個超過 16 KiB 的文字回覆；未列入排除名單的新工具預設套用。
- **超限抑制**：`read()` 與 Codemode `text()` 維持 16 KiB 限制，不建立記憶體結果。Codemode 不介接 `result://` 路徑，避免 `text(await tools.read(...))` 反覆產生虛擬結果；日後另行設計解方。
- **不限制**：`searchSkills()`、`describeSkill()` 暫不限制 16 KiB，日後採分頁或容量控制；Codemode `return` 不受限制。非文字 content 與 `structuredContent` 不轉換。
- 輸出策略（unlimited／suppress／store）集中於 `src/tools/outputLimit.ts`。
- 上述規則同時適用於直接 MCP Server 與 Socket MCP Client；新增或更改工具時，需同步檢查這份套用／排除清單與測試。

## read() metadata

讀取結果另附 `[read-metadata]` JSON（size 為 bytes、totalLines 為完整檔案行數），即使內容超限抑制仍保留。offset 可為非零負整數，自 EOF 倒數，超出總行數時從第一行開始；沿用 LF 分割語意（尾端 LF 產生空行）。timeout 預設 30 秒、最大 90 秒，0 停用工具逾時；逾時回傳已取得內容及 timedOut/incomplete，未知 metadata 為 null，不轉背景。為取得總行數需掃描完整快照，負數 offset 再掃描選取範圍；Codemode 以文字附加 metadata，仍不支援 result://。
