# NOTE

Terminal Toolkit 尚未完成、值得後續追蹤的事項。已完成的實作與歷史進度以 Git 紀錄為準。

## MCP Skills 相容層

- [ ] 評估是否提供選用的 MCP Tools 相容層，例如 `listSkills()`、`getSkill(name)`，供尚未原生支援 MCP Skills Extension（SEP-2640）的 AI Client 探索、讀取 Skills。
- 應重用現有 `skills/list`、`skills/get`、`resources/read` 與外部 Skills 設定的清單、驗證及讀取邏輯；先確認 ChatGPT 對 MCP Skills 的實際支援行為，再決定預設／opt-in、Codemode 揭露及避免功能重複的方式。
- 一般 MCP Tool 讀取 `SKILL.md` 不等於原生安裝、啟用或自動觸發 Skill。

## Codemode 探索體驗

- [x] 頂層 `codemode()` description 已揭露 `tools/core` 的 `read`、`write`、`edit`、`shell` 與 PTY/Misc 分工；namespace 與工具描述也加入檔案操作優先規則。後續仍可觀察 Agent 實際選擇行為。
- [ ] P2：工具數量增加或搜尋品質不足時，評估將 `searchTools()` 的字串比對升級為 BM25；目前非必要。
