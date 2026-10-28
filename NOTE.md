# NOTE

- [ ] `--no-session-operators`

近期尚未完成、值得後續追蹤的事項。

## 追查 `npm_config_allow_scripts` 的來源

- `npx -y louisje/terminal-toolkit` 曾遇到 `EALLOWSCRIPTS`；已確認 repo 本身與 `node-pty` 不是根因。
- 問題來自 shell session 殘留的 `npm_config_allow_scripts` / `npm_config_allow_git` 環境變數；清除後官方 `node-pty` 可正常安裝與啟動。
- 已檢查常見 shell/npm 設定檔但未找到來源，之後可追查是哪個父進程或 launcher 動態注入。

## `.claude-plugin` 安裝與 `node-pty` native dependency

- `node-pty` 是 native module，無法直接被 esbuild bundle。
- `.claude-plugin` 若只是 git clone、不執行 `npm install`，目標機器沒有可用的 `node-pty` 時仍可能啟動失敗。
- 待評估是否 vendor prebuilt binary，或採用其他能可靠部署 native dependency 的方式。

## build 文件同步

- `install.sh` 與 README 尚需確認是否完整反映目前 build 流程：`tsc --emitDeclarationOnly && node scripts/build.mjs`。

## 測試參數與 `client.test.ts`

- 曾執行 `npm test -- test/platform.test.ts` 時仍跑全套測試，且 `client.test.ts` 出現 `Cannot find module ../package.json`（由 `src/utils/version.ts` require）。
- `node --test --import tsx test/platform.test.ts` 單跑可通過。
- 待確認 npm test 的參數轉發行為，以及 `client.test.ts` / version 測試環境是否仍有問題。

## `feat/codemode` 合併前待辦（2026-10-20）

**合併門檻：全部 P0、P1 完成且驗收通過；P2 可暫緩。**

本地 P0/P1 驗證完成（76/76 測試、lint 0 error）；最後一次新提交的跨平台 CI 尚待驗證，因此暫不合併 main。

進度：P0 已通過 `981e682` 的 CI；工具探索權限/參數邊界測試已補。Plugin 啟動仍有約 13–15 秒的獨立整合測試耗時，但已移除預設可選 resvg npm 同步安裝（需設 TERMINAL_TOOLKIT_INSTALL_OPTIONAL_RESVG=1 才安裝），避免網路依賴拖慢冷啟動；必需的 node-pty 仍保留安裝邏輯。Codemode 的 AbortSignal／timeout 已接通 Headless、Socket、sleep 與 bash。`bash` 參考 Pi 的程序樹終止策略：Unix 建立獨立 Process Group 並發送 SIGKILL，Windows 使用 taskkill /T /F。取消後不會派送新的 PTY 呼叫；PTY Session 與已發生的檔案副作用不自動回滾。新增背景子行程取消測試，並於 read/write/edit 寫入前檢查取消。原先 CI 缺 rg/fd 問題已修正，`981e682` 跨平台 CI 全數成功；此輪 P1 修改仍須確認 CI。

- [x] **P0：取消與逾時安全性**：驗證 QuickJS 執行逾時、AbortSignal 與 MCP Client 中斷時，執行中的 `bash`、PTY 操作及其他非同步工具是否會停止或繼續執行；釐清工具副作用不可回滾的情況，必要時補上取消訊號傳遞、子行程清理和迴歸測試。
- [x] **P0：跨平台 CI**（`981e682` 已完成成功；新 P1 提交另需追蹤）：查驗 `feat/codemode` GitHub Actions 的實際結果（Node.js 22/24；Linux/macOS/Windows 建置及 Linux/macOS 測試），特別確認 Windows 的 QuickJS Worker、WASM 路徑與打包相容性，修正失敗項目。
- [x] **P1：工具探索一致性**：補齊 `searchTools()`、`describeTool()`、`describeNamespace()` 的權限、參數驗證及邊界測試；確保只可發現當前已啟用的 tools，且 `terminal` namespace / MCP Instructions 保持一致。
- [x] **P1：Claude Plugin 啟動效能**：追查 `bootstrap.cjs` 整合測試耗時不穩（曾達 30～50 秒）的原因，區分依賴檢查、選用 resvg 補裝及測試資源競爭；改善測試穩定性，避免不必要的網路安裝。
- [x] **P1：文件與 Skills**（已核對 README、SKILL.md、Headless／Socket 測試與 Plugin bootstrap 測試）：補齊 README、使用者文件及 AI-facing Skills 的 `--codemode` 範例、工具探索、輸出過濾、PTY/session 使用規則，以及 Node.js >=22.19 的需求；核對 Headless、Socket、Claude Plugin 三種入口。
- [ ] **收尾**：P0 與 P1 全部完成且驗證通過後，才評估將 `feat/codemode` 合併至 `main`；目前不合併。
- [ ] **P2（視需求）**：若工具數量/namespace 增加，再考慮將 `searchTools()` 的簡單字串比對升級為 BM25，以及新增更細的 namespace 分組；目前不列為合併阻擋項。

## Operator naming and usage (2026-10-22)

- Renamed the optional Pi `bash` tool to `shell` (the configured interpreter is not necessarily Bash); keep examples and tests synchronized.
- Prefer PTY for long-running compile/build/test work; reserve stateless `shell` for quick one-shot commands.

## MCP Skills 相容層評估（2026-10-28）

- [ ] 評估是否提供可選的 MCP Tools 相容層，例如 `listSkills()`、`getSkill(name)`，讓尚未原生支援 MCP Skills Extension（SEP-2640）探索／匯入的 AI Client，仍能透過一般 MCP Tools 發現並讀取由內建 `skills/` 及 `~/.config/terminal-toolkit/settings.json` 指定的外部 Skills。
- 保留既有 SEP-2640 `skills/list`、`skills/get`、`resources/read` 為標準途徑；相容層應重用同一套 Skill 清單、驗證及讀取邏輯，避免重複實作。
- 需先確認 ChatGPT 實際對 MCP Skills 的支援與匯入行為，再決定相容層的啟用方式（預設或 opt-in）、在 `--codemode` 下的工具揭露，以及如何避免功能重複。
- 透過一般 MCP Tool 讀取 `SKILL.md` **不等於** ChatGPT 原生安裝或啟用 Skill，也不保證自動觸發；這項功能僅作為跨 Client 的探索與讀取備援。現階段先記錄，不實作。
