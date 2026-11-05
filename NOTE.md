# NOTE

Terminal Toolkit 尚未完成、值得後續追蹤的事項。已完成的實作與歷史進度以 Git 紀錄為準。

## 追查 npm 環境變數來源

- [ ] 追查 shell session 中 `npm_config_allow_scripts`、`npm_config_allow_git` 是由哪個父行程或 launcher 動態注入。
- 背景：`npx -y louisje/terminal-toolkit` 曾出現 `EALLOWSCRIPTS`；清除殘留環境變數後，`node-pty` 可正常安裝與啟動。已排除 repo 與 `node-pty` 本身，常見 shell/npm 設定檔亦未找到來源。

## Claude Plugin 的 node-pty 原生依賴

- [ ] 評估僅透過 Git clone 安裝 `.claude-plugin`、未執行 `npm install` 時，如何可靠提供平台相依的 `node-pty`（例如預編譯檔或其他安裝機制）。
- `node-pty` 無法直接打包進 esbuild 的單一 JavaScript 檔案。

## 測試行為

- [ ] 重新驗證 `npm test -- test/platform.test.ts` 的參數轉發行為，以及 `client.test.ts` 曾發生的 `Cannot find module ../package.json` 問題（涉及 `src/utils/version.ts`）。先前 `node --test --import tsx test/platform.test.ts` 可單獨通過。

## MCP Skills 相容層

- [ ] 評估是否提供選用的 MCP Tools 相容層，例如 `listSkills()`、`getSkill(name)`，供尚未原生支援 MCP Skills Extension（SEP-2640）的 AI Client 探索、讀取 Skills。
- 應重用現有 `skills/list`、`skills/get`、`resources/read` 與外部 Skills 設定的清單、驗證及讀取邏輯；先確認 ChatGPT 對 MCP Skills 的實際支援行為，再決定預設／opt-in、Codemode 揭露及避免功能重複的方式。
- 一般 MCP Tool 讀取 `SKILL.md` 不等於原生安裝、啟用或自動觸發 Skill。

## Codemode 探索體驗

- [ ] 評估在頂層 `codemode()` description 直接簡短揭露常用工具（`read`、`write`、`edit`、`shell`、PTY 操作），避免 Agent 僅搜尋到 `shell` 就停止探索。現已支援 `tools/pi`、`tools/pty`、`tools/misc` namespace；仍須驗證初始引導是否足夠。
- [ ] P2：工具數量增加或搜尋品質不足時，評估將 `searchTools()` 的字串比對升級為 BM25；目前非必要。
