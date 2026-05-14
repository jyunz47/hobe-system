---
name: project-line-integration
description: 未來計畫串接 LINE Official Account，用於補課確認訊息推播
metadata:
  type: project
---

計畫將系統與 LINE Official Account 連動，實現補課安排的訊息推播流程。

**Why:** 目前補課安排完成後，還需要人工通知學生家長和老師，希望自動化這個流程。

**How to apply:** todos 第三項「生成可傳給學生家長及老師的訊息」是這個串接的前置功能——先做訊息生成與確認流程，之後再接 LINE Official API 推播。設計訊息功能時，訊息格式要考慮 LINE 的顯示方式（純文字或 Flex Message）。流程順序：先詢問學生/家長該時段是否可以，確認後再通知老師。
