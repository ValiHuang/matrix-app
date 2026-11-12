[README.md](https://github.com/user-attachments/files/34763434/README.md)
# 🧭 PASS | 個人行政秘書系統
> **PASS (Personal Administrative Secretary System)**  
> 一款基於「艾森豪矩陣（Eisenhower Matrix）」輕重緩急架構打造的現代全方位個人生產力 Web / PWA 應用。  
> 整合智慧四象限自動排程、Google 日曆與工作（Tasks）雙軌連動、多端零帳號極致隱私雲端同步、購物清單、便簽與快速記帳模組。

🌐 **線上立即體驗：** [https://valihuang.github.io/matrix-app/](https://valihuang.github.io/matrix-app/)

---

## ✨ 核心特色與亮點

### 1. 🧭 輕重緩急四象限排程 (Eisenhower Matrix)
* **智慧升冪排序**：待辦事項依據「截止日期」自動由近至遠排序，最急迫的事項永遠置頂。
* **動態緊急判定**：提供自訂「緊急天數設定」（預設未來 3 天內），系統每日自動偵測並將即將到期的任務自動移入「緊急」象限。
* **清晰色彩架構**：
  * 🔴 **重要且緊急** (`#B70E00`)：立即處理。
  * 🟡 **緊急但不重要** (`#B89B00`)：委派或快速處理。
  * 🔵 **重要但不緊急** (`#0C00B8`)：排程規劃與專注深耕。
  * 🟢 **不急也不重要** (`#00B852`)：減少做或抽空處理。
* **批次完成與還原機制**：支援多選批次歸檔（「✓ 勾選項目已完成」），並可在側邊欄歷史紀錄中「↺ 還原所選事項」。

### 2. 🗓️ Google 日曆與工作 (Tasks) 智慧雙軌同步
* **智慧雙軌同步架構**：
  * **有填寫「提醒時間」**：自動在 Google 日曆建立帶有特定時間的「**活動 (Event)**」，並在指定時間由 Google 準時發送推播通知。
  * **未填寫「提醒時間」**：自動在 Google 日曆建立全天「**工作 (Task)**」，呈現於日曆頂端方便整日檢視。
* **雙向生命週期聯動**：
  * 在 PASS 點擊完成時，Google 端對應的活動或工作自動同步劃除/刪除。
  * 從歷史紀錄還原時，自動補登回 Google 日曆。
* **當月智慧增量補登 (🔄)**：點擊月份旁的重新整理按鈕，系統會自動掃描並**僅補登當月尚未同步的事項**，絕不重複建立，且**絕不干涉您在 Google 日曆原本編輯的獨立私人行程**。
* **靜默背景自動重連**：支援斷線恢復自動續期（Online Auto-reconnect），免除頻繁手動點擊連線的困擾。

### 3. 🔐 專屬安全同步金鑰 (多端跨平台即時同步)
* **極致隱私、免註冊個人帳號**：不索取信箱、不收集個人資料，純靠使用者自訂的專屬金鑰建立端點通道。
* **高強度安全防護面板**：具備即時強度指示燈，強制要求金鑰長度需達 8 碼以上、且必須包含英文字母與數字。
* **一鍵「🎲 隨機產生」**：自動生成符合高強度標準的安全隨機金鑰（保證包含大小寫、數字與特殊符號）。
* **跨裝置無縫同步**：任何輸入相同金鑰的裝置（Mac、Windows、iPhone、iPad、Android），所有待辦、記帳、便利貼與清單皆由 Firebase Firestore 即時雙向同步。

### 4. 🛠️ 實用輔助模組
* **🛒 購物清單**：支援項目打勾標記，即時動態統計已勾選數量，一鍵清除已完成項目。
* **📝 便利貼靈感區**：隨手筆記草稿，支援「轉為待辦」一鍵無縫轉入四象限排程。
* **💰 快速收支記帳**：提供收入與支出快速登錄、多層級自訂分類與月份彙整，明細自動依日期降冪排序。
* **📲 PWA 桌面 / 手機原生化體驗**：支援「新增至主畫面」，具備離線操作能力與專屬 App 圖標。

---

## 🚀 技術架構

* **前端介面**：純原生 HTML5、CSS3（含 Custom Properties、Flexbox & CSS Grid 響應式佈局）、原生 Vanilla JavaScript（ES6+）
* **資料同步**：Firebase Firestore (Realtime Snapshot 雙向監聽) + 本地 LocalStorage 雙重備份
* **Google API 整合**：Google Identity Services (GIS SDK)、Google Calendar API v3、Google Tasks API v1
* **離線與快取**：Progressive Web App (PWA)、Service Worker (Network-First 策略與版本快取防撞機制)

---

## 📱 安裝至手機 / 平板桌面 (PWA)

1. 使用 **Safari (iOS / iPadOS)** 或 **Chrome (Android)** 打開 [https://valihuang.github.io/matrix-app/](https://valihuang.github.io/matrix-app/)。
2. 點擊瀏覽器底部的 **「分享」** 按鈕（iOS）或右上角 **選單**（Android）。
3. 選擇 **「加入主畫面 (Add to Home Screen)」**。
4. 即可在桌面生成專屬的 PASS 四色應用程式圖示，享受全螢幕原生操作！

---

## 📄 授權與宣告
本專案為個人行政效率管理工具，所有行事曆授權均在使用者本地端與 Google 官方伺服器之間進行安全傳輸，本系統不儲存任何使用者的 Google 帳號與行事曆隱私資料。
