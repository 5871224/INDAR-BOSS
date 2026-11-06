# INDAR-BOSS — SOYAL MSG Viewer

BOSS 包含 SOYAL 701Server / 701Client `.msg` 解析及 IP 檢查頁面。匯入的檔案只在瀏覽器本機讀取，不上傳伺服器。

本專案是 INDAR 入口中的 BOSS 應用，正式網址為 `https://192.168.1.29/boss/`。門號與使用者設定由同一台 Ubuntu 上的本機 API 讀寫獨立 PostgreSQL database `soyal`；不再使用 Supabase。

## 頁面結構

`index.html` 是 BOSS 入口及共用標頭，SOYAL 的程式與樣式放在 `pages/soyal/`；其他功能放在各自的 `pages/` 子目錄，從入口的分頁進入。切換分頁不會重新載入共用標頭或清除目前畫面，IP 頁首次開啟時才載入；舊 IP 網址會導向入口的 IP 分頁。新增靜態檔案時需同步更新 `scripts/install-soyal.sh` 的安裝清單。舊 `/soyal/` 網址與 API 會以 308 重新導向至 `/boss/`。

## IP檢查

`pages/ip/` 提供名稱、MAC、IP 與 `/32 DROP` 規則檢查，也可匯入包含 `eventTime`、`dstIp`、`srcIp` 欄位的事件 CSV，更新阻擋 IP，排除指定 IP，依合併數量產生 `/24` 規則，排序及複製去重結果。既有清單可由含 `IP`、`更新時間` 欄位的 UTF-8 CSV 匯入，選用 `排除IP` 欄位一併匯入排除名單，也可逐行貼上。合併後顯示同網段最新時間，但保留各 IP 原始時間；調高門檻後可恢復各筆時間。

阻擋清單與設定儲存在目前瀏覽器的本機儲存空間，不會跨設備或瀏覽器同步。使用下載備份及還原備份轉移資料，清除瀏覽器資料前應先備份。原 Excel 檔案及實際 IP 資料不放入儲存庫。

## 第一版功能
- 拖放/選取一個或多個 `.msg`
- 依 100 bytes / record 解析
- 顯示事件時間、Source Node、Door、User Address、Function Code、701 接收時間
- Node / Function Code 篩選與全文搜尋
- 單筆 100-byte HEX/Offset 檢視
- 匯出 CSV
- Ubuntu 本機部署與 PostgreSQL API

## 格式依據
SOYAL 官方 FAQ 指出 `.msg` 每筆固定 100 Bytes，701Server/Client 以日期 `.msg` 保存事件；公開資料可辨識 TM_EVENT、TM_REC、CTL_NODE、DOORNO、LOG_CODE、USER_ADDR 等欄位。未公開 Offset 在 UI 中標記為「未確認」。

參考：
- https://soyal.com/faq.php?act=view&id=814
- https://www.soyal.com.tw/faq.php?act=view&id=566
- https://files.soyal.com.tw/TW/download/Cross-System%20Integration/SOYAL%20INTEGRATION%20-%20TWO%20WAY%20HOSTING.pdf

## 本機測試
```bash
npm install
npm run check
npm test
```
測試預設使用 `/mnt/data/20260901.msg`，也可：
```bash
node tests/parser.test.mjs /path/to/YYYYMMDD.msg
```

## Ubuntu 部署

建立獨立資料庫與角色（請由具備 PostgreSQL 管理權限的管理員執行）：

```bash
sudo -u postgres createuser --login --pwprompt soyal_app
sudo -u postgres createdb --owner soyal_app soyal
psql "$DATABASE_URL" -f database/schema.sql
```

`DATABASE_URL` 必須指向 `soyal` database，例如：

```text
postgresql://soyal_app:<password>@127.0.0.1:5432/soyal
```

不要把包含密碼的連線字串放入 Git 或 `/srv/web/boss/`；systemd 的環境檔應放在 `/etc/indar-soyal/database.env`，權限設為 `0640`，由服務帳號可讀。

安裝完成後由 Nginx 提供 `/boss/` 靜態頁面，並將 `/boss/api/` 反向代理到 `127.0.0.1:3070/api/`。`database/schema.sql` 只建立獨立 `soyal` database 內的 `door_settings`、`user_settings`、`soyal_access` 及必要權限，不會修改 INDAR 既有資料庫。

BOSS 不另外建立第二組使用者密碼：一般使用者沿用 INDAR 班表的 `indar_session` 登入狀態，但只有管理頁「權限設定 → BOSS」列出的在職員工可以進入。首頁對所有訪客顯示 BOSS 按鈕，進入時由 `/api/access` 檢查權限；直接輸入網址也不能繞過權限。具 `permission_settings` 的班表管理員可在 `/admin.html#permissions` 維護名單。

尚未登入時，BOSS 會導向 INDAR 共用登入頁 `/login.html`。登入成功返回後再次檢查 BOSS 權限；不在名單內的帳號無法進入。

導向登入使用 INDAR 入口維護的 `/shared/auth-entry.js`；請先發布 INDAR 的共用登入頁及腳本，再發布本頁。

標頭顯示 BOSS 權限 API 回傳的員工姓名與代碼；登出會結束共用 INDAR 登入工作階段。若畫面有尚未保存的資料，登出前會提示確認。

若要把現有 Supabase 設定資料帶入新 database，先完成建庫、schema 與 `/etc/indar-soyal/database.env`，再執行：

```bash
set -a
. /etc/indar-soyal/database.env
set +a
node scripts/migrate-from-supabase.mjs
```

匯入程式會先確認目前連線的 database 名稱確實是 `soyal`，再以 transaction upsert 兩張表，避免誤寫入 INDAR 原有資料庫。

一次性安裝順序：

```bash
sudo install -d -o root -g indar -m 0750 /etc/indar-soyal
sudo install -o root -g indar -m 0640 deploy/database.env.example /etc/indar-soyal/database.env
sudoedit /etc/indar-soyal/database.env
sudo bash scripts/install-soyal.sh
sudo bash /home/indar/deploy/INDAR/scripts/install-intranet.sh
```

執行 INDAR 安裝程式前，先把 `deploy/indar-soyal.nginx.conf` 的 location 放入 INDAR 的 default HTTPS server；它設定 `/boss` 路由及舊 `/soyal` 的導向，不會改動其他應用路由。
