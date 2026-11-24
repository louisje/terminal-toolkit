# NOTE

開發現況與交接摘要；滾動更新，不作永久流水帳。未來規劃、待辦與研究見 [ROADMAP.md](ROADMAP.md)，長期技術知識與驗收紀錄見 docs/，歷史變更以 Git 為準。

## Current Status

- Runtime Execution Manager v1 已於 2026-11-24 完成 macOS 驗收（功能版本 `fa2ed74`）。
- 目前無進行中的功能開發；跨平台驗證不阻擋 v1 結案。

## In Progress

- 無。開始新功能時在此記錄範圍、階段、驗收條件及下一步；完成後移至近期成果。

## Recently Completed

- Runtime Execution Manager Phase 0–6：背景執行、五支管理工具、execution:// 唯讀 VFS、配額、保留與 shutdown。macOS npm test 189 項（187 通過、2 略過、0 失敗）；正式 MCP/Socket 與獨立 Manager 的 14 類驗測全部通過。詳見 [設計與驗收](docs/runtime-execution-design.md)。
- In-Memory Result Store：一般非 Codemode 文字結果超過 16 KiB 使用 result://；read()/Codemode text() 維持抑制策略，Skills 探索工具暫不限制。詳見 [輸出策略](docs/output-policy.md)。

## Known Issues

- 本次 Runtime 驗收未發現需修正的 Bug。已知設計限制與未驗證平台見設計文件及 ROADMAP。

## References

- [ROADMAP.md](ROADMAP.md)：未來規劃、待辦、研究及暫緩事項。
- [Runtime Execution Manager](docs/runtime-execution-design.md)：設計與驗收。
- [Output policy](docs/output-policy.md)：輸出策略及套用範圍。
- [MCP experiments](docs/mcp-experiments.md)：歷史實驗與已確認的觀察。

維護方式：啟動工作時從 ROADMAP 選定範圍，更新 NOTE 的進行中事項；完成時更新設計文件與近期成果、整理 ROADMAP。過時摘要可移除，不重複保存 Git 歷史。
