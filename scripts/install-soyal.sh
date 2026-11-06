#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
  echo '請執行：sudo bash /home/indar/deploy/INDAR-SOYAL/scripts/install-soyal.sh' >&2
  exit 1
fi

repo=/home/indar/deploy/INDAR-SOYAL
target=/srv/web/soyal
env_file=/etc/indar-soyal/database.env
unit=/etc/systemd/system/indar-soyal.service
files=(index.html pages/soyal/app.js pages/soyal/parser.js pages/soyal/excel.js pages/soyal/event-excel.js pages/soyal/settings-excel-ui.js pages/soyal/styles.css pages/ip/index.html pages/ip/app.js pages/ip/logic.js pages/ip/styles.css)

test -s "$repo/package-lock.json"
test -s "$repo/server.mjs"
test -s "$repo/database/schema.sql"
test -s "$env_file"
grep -Eq '^DATABASE_URL=postgres(ql)?://[^[:space:]]+/soyal([?].*)?$' "$env_file"

runuser -u indar -- /usr/local/bin/npm ci --omit=dev --ignore-scripts --prefix "$repo"

install -d -o indar -g indar -m 0755 "$target"
for file in "${files[@]}"; do
  test -s "$repo/$file"
  install -d -o indar -g indar -m 0755 "$(dirname "$target/$file")"
  install -o indar -g indar -m 0644 "$repo/$file" "$target/$file"
done

install -d -o root -g indar -m 0750 /etc/indar-soyal
chown root:indar "$env_file"
chmod 0640 "$env_file"
install -o root -g root -m 0644 "$repo/deploy/indar-soyal.service" "$unit"

systemctl daemon-reload
systemctl enable --now indar-soyal.service
curl --noproxy '*' --fail --silent --show-error http://127.0.0.1:3070/health >/dev/null

echo "INDAR-SOYAL API 已啟用；靜態頁面已發布至 $target。"
echo '請確認 INDAR Nginx 已包含 deploy/indar-soyal.nginx.conf 的 locations，再執行 nginx -t && systemctl reload nginx。'
