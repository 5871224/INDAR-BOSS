# INDAR-SOYAL — SOYAL MSG Viewer

純前端 SOYAL 701Server / 701Client `.msg` 解析器。檔案只在瀏覽器本機讀取，不上傳伺服器。

本專案是 INDAR 入口中的 SOYAL 應用，正式網址為 `https://192.168.1.29/soyal/`。門號與使用者設定由同一台 Ubuntu 上的本機 API 讀寫獨立 PostgreSQL database `soyal`；不再使用 Supabase。

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

不要把包含密碼的連線字串放入 Git 或 `/srv/web/soyal/`；systemd 的環境檔應放在 `/etc/indar-soyal/database.env`，權限設為 `0640`，由服務帳號可讀。

安裝完成後由 Nginx 提供 `/soyal/` 靜態頁面，並將 `/soyal/api/` 反向代理到 `127.0.0.1:3070/api/`。`database/schema.sql` 只建立 `door_settings`、`user_settings` 及必要權限，不會修改 INDAR 既有資料庫。

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

執行 INDAR 安裝程式前，先把 `deploy/indar-soyal.nginx.conf` 的三段 location 放入 INDAR 的 default HTTPS server；它只新增 `/soyal` 路由，不會改動其他應用路由。
