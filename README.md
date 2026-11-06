# INDAR-BOSS — SOYAL MSG Viewer

BOSS 包含 SOYAL 701Server / 701Client `.msg` 解析及 IP 檢查頁面。匯入的檔案只在瀏覽器本機讀取，不上傳伺服器。

本專案是 INDAR 入口中的 BOSS 應用，正式網址為 `https://192.168.1.29/boss/`。門號與使用者設定由同一台 Ubuntu 上的本機 API 讀寫獨立 PostgreSQL database `soyal`；不再使用 Supabase。

## 頁面結構

`index.html` 是 BOSS 入口及共用標頭，SOYAL 的程式與樣式放在 `pages/soyal/`；其他功能放在各自的 `pages/` 子目錄，從入口的分頁進入。切換分頁不會重新載入共用標頭或清除目前畫面，IP 頁首次開啟時才載入；舊 IP 網址會導向入口的 IP 分頁。新增靜態檔案時需同步更新 `scripts/install-soyal.sh` 的安裝清單。舊 `/soyal/` 網址與 API 會以 308 重新導向至 `/boss/`。

## IP檢查

`pages/ip/` 可一次多選匯入包含 `eventTime`、`dstIp`、`srcIp` 欄位的事件 CSV；所有檔案合併去重、保留最新時間，一次寫入資料庫（任一檔格式錯誤時不寫入），更新阻擋 IP，排除指定 IP，依合併數量產生 `/24` 規則，透過表頭圖示排序、搜尋及篩選，並在「轉格式」表頭複製去重結果（畫面中央短暫提示）。修改與刪除圖示採用英達班表相同的 SVG 路徑及 BOSS 配色。合併後顯示同網段最新時間，但保留各 IP 原始時間；調高門檻後可恢復各筆時間。

阻擋 IP 與排除 IP 儲存在獨立 `soyal` PostgreSQL 資料庫中，具有 BOSS 權限的使用者共用。合併數量由各瀏覽器記住，並於本機產生規則，避免互相覆蓋；原資料庫欄位保留相容。排除清單支援單一 IP 或完整段落的 * 萬用字元，例如 `220.130.148.*`，搜尋也支援 *，表格更新日期只顯示日期。排除清單可在「設定排除清單」表格逐列編輯，也可直接貼上從 Excel 複製的儲存格；同時修改時，版本檢查會拒絕覆蓋其他人的更新。資料直接儲存在資料庫，不再使用瀏覽器本機清單。IP 頁的垂直捲軸在瀏覽器最右側，只有主表格的欄位標題會隨外頁捲動固定；SOYAL 分頁維持既有捲動方式。原 Excel 檔案及實際 IP 資料不放入儲存庫。

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

## 既有伺服器路徑切換

原使用 `/srv/web/soyal` 的伺服器可由管理員使用 `sudo bash scripts/migrate-boss-path.sh /path/to/INDAR` 切換至 `/srv/web/boss`；參數應指向含 `/boss/` 路由設定及入口的 INDAR checkout。腳本只適用於記錄的既有檔案版本，遇到差異會停止；會備份、檢查 Nginx 與路由並在失敗時嘗試還原。切換後保留 `/srv/web/soyal` 相容連結，並嘗試觸發首頁自動部署。若伺服器已切換，無須再次執行。

## 既有資料庫升級

對已安裝的獨立 `soyal` 資料庫執行 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/ip-blocking.sql`，建立阻擋 IP、排除 IP 與版本設定資料表。此升級不刪除既有清單。完成後部署程式並重啟 `indar-soyal.service`。

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

安裝完成後由 Nginx 提供 `/boss/` 靜態頁面，並將 `/boss/api/` 反向代理到 `127.0.0.1:3070/api/`。`database/schema.sql` 建立獨立 `soyal` database 內的門號、使用者、權限與 IP 清單資料表及必要權限，不會修改 INDAR 既有資料庫。

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

### 自動部署

推送至 `main` 後，GitHub Actions 先執行檢查與測試，通過後由此專案專用的 `indar-boss` self-hosted runner 部署至內網主機。也可從 Actions 手動執行流程；只有 `main` 可以部署。部署腳本會檢查版本、服務與網站，失敗時還原上一版本。Runner 由主機上的使用者服務 `github-runner-indar-boss.service` 持續執行。
