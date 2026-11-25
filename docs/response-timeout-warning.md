# Response timeout warning

Tunnel Client 在實際 response deadline 前 10 秒，對仍等待回覆的 stdio tools/call 發送 notifications/tunnel/response_timeout_warning，params 為 requestId（原 JSON-RPC ID）與 remainingMs。原 timeout 不超過 10 秒時不發送；已進入預警區間但仍有時間時立即發送。

Terminal Toolkit 對有效的 shell/python 請求回 notifications/tunnel/response_timeout_ack（requestId），透過獨立預警 signal 喚醒 Runtime 前景等待，沿用既有 detach 與 executionId 回覆。Socket Proxy 依本地 request ID 轉發 responseTimeoutWarning，不取消程序。其他工具與 codemode 忽略。ACK 不保證背景化完成，也不延長 deadline；Tunnel Client 不等待、不重送、不向 Control Plane 轉發 ACK。

正常完成與取消仍沿用原機制。預警與完成競態可能使通知在回覆附近抵達；未知或已完成 ID 忽略。若無法及時回覆，原 deadline 仍生效。

2026-11-25：Runtime、Socket、MCP headless 與 proxy 測試通過；正式 Tunnel Client 連線驗收待重啟。
