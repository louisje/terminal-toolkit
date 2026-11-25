# NOTE

記錄正在進行及最近完成的開發事項，供進度掌握與接續開發之用。隨開發進程即時滾動更新，主動淘汰過時資訊，不作永久流水帳；歷史由 Git 保存。未來規劃見 [ROADMAP.md](ROADMAP.md)，維護方式見 [Development workflow](docs/development-workflow.md)。

## In Progress

- 三道死線策略：已提交 `d2811ba`，完整回歸測試 196 項（194 通過、2 略過、0 失敗），待正式環境驗收。
  - 下一步：更新並重啟 Terminal Toolkit Socket Server 與 MCP Server，確認載入新版；Tunnel Client 無須更新版本。
  - 驗收：確認一般工具、Runtime 背景化、waitExecution、取消及各層死線行為；完整 90／100 秒及上游 deadline 實機時序尚未驗證。
  - 參照 [死線設計](docs/request-deadline-design.md)、[預警協定](docs/response-timeout-warning.md)。

## Recently Completed

- Runtime Execution Manager v1：2026-11-24 完成 macOS 驗收（`fa2ed74`），詳見 [設計與驗收](docs/runtime-execution-design.md)。
- Response timeout warning：已部署初版（Toolkit `0fb6217`、Tunnel Client `62e43a6`），正式環境基本功能正常；未刻意觸發上游逾時。
- In-Memory Result Store：詳見 [輸出策略](docs/output-policy.md)。
