# 設計文件:Notion Clone(Obsidian 增強版)

- 日期:2026-07-14
- 狀態:待審(Draft)
- 專案目錄:`/Users/ray/Documents/notion-clone`

## 1. 一句話定位

開源、可自架、資料完全自主的 1:1 Notion 桌面應用(Mac / Windows / Linux),
以 Obsidian 的核心價值增強:**沒有這個 app、沒有任何公司,你的資料照樣活著**。

## 2. 第一性原理推導(為什麼是這個架構)

需求本質拆成四條公理,每條推出一個不可妥協的結論:

| # | 公理(需求本質) | 推論(架構結論) |
|---|---|---|
| 1 | Obsidian 的本質 = 資料離開 app 依然可讀、可搬、可自架 | 磁碟上必須有開放格式副本;server 必須是可自架的開源軟體 |
| 2 | Notion 的本質 = 結構化資料(block 樹、屬性、關聯、views),不是文件 | 真相來源必須是資料庫,不能是純 Markdown 檔 |
| 3 | 同步引擎是最深的坑,且不是本產品的差異化所在 | 同步必須用開源、可自架的現成引擎,不自己寫 |
| 4 | 三平台 1:1 UI | Web 技術 + 桌面殼 |

推論 1 與推論 2 的調和:**資料庫為真相,Markdown 為投影(鏡像)**。
自主權由「本地鏡像檔 + 你自己的 server(可 pg_dump)」共同保障,而非由 Markdown-as-truth 保障。

## 3. 已定案的架構決策

| 決策點 | 定案 | 落選方案與理由 |
|---|---|---|
| 使用情境 | 單人使用、多裝置同步 | 多人即時協作(CRDT/帳號/權限)延後,不進本設計 |
| 真相來源 | Postgres(自架 server)為真;PGlite(WASM 內嵌 Postgres)為本地快取 | Markdown-as-truth(database views 做不到);雙向雙真相(衝突地獄) |
| 同步引擎 | ElectricSQL:讀路徑 Postgres → PGlite 自動同步;寫路徑走薄 API + 離線操作佇列 | 自寫同步(工程量與除錯深不見底);檔案同步搭便車(衝突不可控) |
| 同步模型 | 照 Notion 本尊:server 為真 + 本地快取 + 離線佇列 + block 層級 last-write-wins | CRDT(單人情境過度工程) |
| 自主權保障 | (a) Markdown 鏡像:每頁自動寫出 `.md` + YAML frontmatter 到使用者指定資料夾;(b) server 全開源可自架、可 pg_dump 帶走 | — |
| 編輯器 | BlockNote(ProseMirror 系,開源 Notion 式 block 編輯器) | 裸 ProseMirror/TipTap 自組(多 2-3 個月換取的自由度目前用不到,保留為逃生門) |
| 桌面殼 | Electron,**薄殼紀律**(見 §5);v2 保留換 Tauri 的退路 | Tauri 先行(三種 webview 的 contenteditable/IME quirks 與編輯器核心期相衝;Windows 上省 RAM 是假的) |
| 本地資料庫引擎 | PGlite(與 Electric 生態同構,SQL 與 server 端一致) | SQLite(成熟但與 Electric 不同構,同步要自己搭) |

### 風險承認(接受的代價)

- **PGlite 年輕**(2024 年問世):單人筆記量級可行,edge case 會比 SQLite 早遇到。緩解:server 為真相,本地壞了可重拉;鏡像檔永遠在。
- **Electron 體積/RAM**(~150MB 安裝包、~150-250MB 額外 RAM):以薄殼紀律把換殼成本壓到最低,痛可延後付。
- **BlockNote 客製天花板**:深度客製受限時,它底層就是 ProseMirror,可逐步下沉,不需重寫。

## 4. 資料模型(Notion 語意)

```
workspace
└── page(樹狀巢狀,page 也是一種 block)
    └── block(有序樹)
        ├── type: paragraph | heading | list | todo | toggle | code | quote |
        │         image | divider | page(子頁)| database | ...
        ├── props: jsonb(各 type 自己的屬性)
        └── children: block[]

database(特殊 block)
├── schema: 屬性定義(text / number / select / multi-select / date / checkbox / relation)
├── rows: 每個 row 本身是一個 page(Notion 語意:資料列即頁面)
└── views: table | board | calendar,各自帶 filter / sort / group 設定
```

Postgres 表(server 與 PGlite 兩端同構):

- `pages(id, parent_id, title, icon, sort_key, created_at, updated_at, deleted_at)`
- `blocks(id, page_id, parent_block_id, type, props jsonb, sort_key, updated_at)`
- `databases(id, block_id, schema jsonb)` / `db_views(id, database_id, type, config jsonb)`
- `ops_queue`(僅本地):離線寫入佇列,上線後 replay 到寫入 API

排序用 fractional indexing(`sort_key` 字串),拖拉排序不需重寫兄弟節點。

## 5. 系統分層與薄殼紀律

```
┌─ Electron 殼(薄:只做 3 件事)────────────────┐
│  檔案存取(鏡像檔寫出)/ 視窗 / 原生選單          │
├─ Web 層(所有邏輯都住這裡)─────────────────────┤
│  React + BlockNote 編輯器                        │
│  PGlite(WASM)+ Electric client(讀同步)       │
│  離線佇列 + 寫入 client                          │
│  Markdown 鏡像序列化器(block 樹 → md)          │
├─ Server(你自己的 VPS / fly.io)────────────────┤
│  Postgres + ElectricSQL + 薄寫入 API(單一使用者 │
│  token 驗證,無帳號系統)                        │
└──────────────────────────────────────────────────┘
```

**薄殼紀律(硬規則)**:web 層不得 import 任何 Electron API;殼與 web 層之間只走一個窄介面
(`saveFile / readFile / showMenu` 級別)。這是 v2 換 Tauri 的保險,違反即 review 打回。

## 6. 里程碑(每階結束都是天天可用的產品)

### M1 — 能寫(單機可用,無 server)
- Electron 薄殼 + React + BlockNote
- PGlite 本地存取(block 樹 CRUD)
- 側欄:頁面樹、巢狀、新增/刪除/重命名
- Markdown 鏡像:存檔即寫出 `.md`(含 frontmatter:id、建立時間、屬性)
- 驗收:斷網、殺掉 server 概念不存在 —— 因為根本還沒有 server,一切本地

### M2 — 能同步(第二台裝置)
- 自架 Postgres + ElectricSQL(docker compose 一鍵)
- 薄寫入 API + 離線佇列 replay + block 級 LWW
- 驗收:兩台裝置輪流離線編輯同一頁,上線後收斂一致、不丟字

### M3 — 能管理(Notion 的靈魂)
- Database block:schema、屬性、row-as-page
- Table view → Board view → Calendar view(依序)
- Filter / sort / group
- 驗收:用它管理本專案的任務看板

### M4 — 能超越(Obsidian 增強)
- `[[wiki-link]]` 雙向連結 + backlinks 面板
- 全文搜尋(Postgres FTS / PGlite 端同款)
- Markdown 匯入(整個 vault 搬進來)/ 匯出(本來就有鏡像,補打包)
- 驗收:把一個既有 Obsidian vault 匯入,連結不斷、可反查

### 明確不做(本版)
多人協作、帳號系統、權限、分享網頁、評論、AI 功能、行動端。

## 7. 開放問題(不擋 M1)

- 鏡像檔的資料夾結構:照頁面樹巢狀資料夾 vs 平鋪 + frontmatter 記 parent(傾向前者,Obsidian 相容)
- database row 的鏡像格式:frontmatter properties(傾向)vs 獨立 CSV
- Electric 寫路徑細節:直接 REST vs Electric 的 write pattern 範本(M2 開工時依當時官方建議定)

## 8. Review Findings 決議(2026-07-14 spec review)

| # | Finding | 決議 |
|---|---|---|
| F1 | Postgres FTS 不斷中文詞,M4 搜尋對 CJK 失效 | 放棄 tsvector,改 `pg_trgm` + ILIKE(PGlite 支援 pg_trgm),標題命中加權;量大再議 |
| F2 | BlockNote JSON ↔ blocks 列映射未定義 | **同步粒度 = BlockNote 頂層 block**:一個頂層 block 一列,`props` 存該 block 完整 JSON(含 inline content 與巢狀 children)。LWW 以頂層 block 為單位 |
| F3 | LWW 用 client 時鐘會被時鐘偏斜咬 | server 套用寫入時蓋上 `server_seq`(單調遞增),衝突以 server 到達序為準;client `updated_at` 僅供顯示 |
| F4 | 鏡像檔可能寫一半殘損 | 原子寫入(temp + rename)+ 500ms debounce,殼層實作 |
| F5 | PGlite 持久化位置 vs 薄殼紀律 | PGlite 跑 renderer(Electron 的 Chromium 支援 OPFS 持久化);自主權由鏡像檔(真檔案)保障,本地 DB 視為可重建快取,鏡像可完整 reimport |
| F6 | 兩端 schema 漂移 | 共用 `shared/migrations/*.sql`,PGlite 與 server Postgres 跑同一組檔案 |
| F7 | fractional sort_key 離線同鍵碰撞 | 產 key 時尾端附短隨機 jitter,碰撞機率降到可忽略;顯示端以 (sort_key, id) 雙鍵排序保證穩定 |
