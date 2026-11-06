#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo '請以 sudo 執行此腳本。' >&2; exit 1; }
app=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ $# != 1 ]]; then
  echo '用法：sudo bash scripts/migrate-boss-path.sh /path/to/INDAR' >&2
  exit 1
fi
portal=$(cd -- "$1" && pwd -P)
old=/srv/web/soyal
new=/srv/web/boss
config=/etc/nginx/sites-available/indar
[[ -d "$old" && ! -L "$old" && ! -e "$new" && ! -L "$new" ]]
for file in "$app/pages/soyal/app.js" "$app/pages/ip/app.js" "$portal/dist/index.html" "$portal/dist/admin.js" "$portal/deploy/indar.nginx.conf"; do test -s "$file"; done
exec 9>/home/indar/.deploy-shift-sched.lock
flock -w 30 9
exec 8>/home/indar/.deploy-indar.lock
flock -w 30 8
# Refuse to overwrite live assets if they changed since the migration was prepared.
check_sha() {
  local expected=$1 file=$2 actual
  actual=$(sha256sum -- "$file")
  [[ ${actual%% *} == "$expected" ]] || { echo "檔案與預期版本不符：$file" >&2; exit 1; }
}
check_sha e5f7e4685cd0ca22b65de49aa2b4e89cf82eeb084d9fd59543f0b97e016c85c7 /srv/web/indar/index.html
check_sha 63fe3c8cbe94b34ee924f5bdec51af9fe8e8ca0f08903b73ead364dac3b4d96a /srv/web/indar/admin.js
check_sha 55be8e4b197789beafba247a94ae9b32fdcbe7d36e698e6c0122679660f487ea "$old/pages/soyal/app.js"
check_sha c61ddbccac2fe7e6d6914636b3ac9a92dfd9418973c40edee2a9f76e80b834d1 "$old/pages/ip/app.js"
check_sha a5e2ea56cfbf2cade1d4551efac177a7919fdbaa5044bfe523331b962cfea8d9 "$config"
check_sha 323ec5d252374658cda074e4b22ae1b160164d2c2fa3123bfbc5432756e4cec1 "$app/pages/soyal/app.js"
check_sha 84af766f451f4ea1a4e53faadb6d1976deb9195733337c7ad0e35b6cd85e079b "$app/pages/ip/app.js"
check_sha 2ecd571b6fb84fd29171b794d4b8e4588549aa201374e072814a4b25908543b0 "$portal/dist/index.html"
check_sha ca8c2e2871fe679fb6fc12eef5e0308a4cb6818d1e1d598b48ae8eea1612bf0a "$portal/dist/admin.js"
check_sha 1bf558d58ce5b3c812937368b32f5c542c960b5121c99c6a574dc27267b999ba "$portal/deploy/indar.nginx.conf"
backup_root=/home/indar/backups/indar-boss-migration
install -d -m 0700 "$backup_root"
backup=$(mktemp -d "$backup_root/deploy.XXXXXX")
cp -a "$config" "$backup/nginx.conf"
cp -a /srv/web/indar/index.html "$backup/index.html"
cp -a /srv/web/indar/admin.js "$backup/admin.js"
cp -a "$old/pages/soyal/app.js" "$backup/soyal-app.js"
cp -a "$old/pages/ip/app.js" "$backup/ip-app.js"
python3 - "$config" "$portal/deploy/indar.nginx.conf" "$backup/candidate.conf" <<'PY'
from pathlib import Path
import sys
live=Path(sys.argv[1]).read_text()
new=Path(sys.argv[2]).read_text()
def block(text, begin, end):
 if text.count(begin)!=1 or text.count(end)!=1: raise ValueError('Nginx 區塊與預期不符')
 start=text.index(begin); finish=text.index(end,start)+len(end)
 return start,finish
start,finish=block(live,'    # INDAR-SOYAL begin','    # INDAR-SOYAL end')
a,b=block(new,'    # INDAR-BOSS begin','    # INDAR-BOSS end')
Path(sys.argv[3]).write_text(live[:start]+new[a:b]+live[finish:])
PY
moved=0
rollback() {
 status=$?
 trap - ERR INT TERM
 set +e
 cp -a "$backup/nginx.conf" "$config"
 cp -a "$backup/index.html" /srv/web/indar/index.html
 cp -a "$backup/admin.js" /srv/web/indar/admin.js
 if [[ $moved == 1 ]]; then
  rm -f "$old"
  cp -a "$backup/soyal-app.js" "$new/pages/soyal/app.js"
  cp -a "$backup/ip-app.js" "$new/pages/ip/app.js"
  mv "$new" "$old"
 fi
 /usr/sbin/nginx -t && /usr/bin/systemctl reload nginx
 echo "切換失敗，已嘗試還原。備份：$backup" >&2
 exit "$status"
}
trap rollback ERR INT TERM
mv "$old" "$new"
moved=1
ln -s boss "$old"
install -o indar -g indar -m 0644 "$app/pages/soyal/app.js" "$new/pages/soyal/app.js"
install -o indar -g indar -m 0644 "$app/pages/ip/app.js" "$new/pages/ip/app.js"
install -o indar -g indar -m 0644 "$portal/dist/index.html" /srv/web/indar/index.html
install -o indar -g indar -m 0644 "$portal/dist/admin.js" /srv/web/indar/admin.js
install -o root -g root -m 0644 "$backup/candidate.conf" "$config"
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
curl_opts=(--noproxy '*' -kfsS --connect-timeout 2 --max-time 3 --resolve 192.168.1.29:443:127.0.0.1)
# systemctl reload returns after sending nginx the signal; old workers may still
# answer briefly. Wait for the new route before declaring the cutover failed.
ready=0
for attempt in {1..40}; do
  if curl "${curl_opts[@]}" https://192.168.1.29/boss/ -o "$backup/route-probe.html" 2>/dev/null && cmp -s "$backup/route-probe.html" "$new/index.html"; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ $ready != 1 ]]; then
  echo 'Nginx 在等待後仍無法提供 /boss/ 首頁，準備還原。' >&2
  false
fi
curl "${curl_opts[@]}" https://192.168.1.29/boss/pages/soyal/app.js | cmp - "$new/pages/soyal/app.js"
curl "${curl_opts[@]}" https://192.168.1.29/ | cmp - /srv/web/indar/index.html
curl "${curl_opts[@]}" https://192.168.1.29/boss/pages/ip/app.js | cmp - "$new/pages/ip/app.js"
redirect=$(curl --noproxy '*' -ksS --resolve 192.168.1.29:443:127.0.0.1 -o /dev/null -w '%{http_code} %{redirect_url}' 'https://192.168.1.29/soyal/?test=1')
[[ "$redirect" == '308 https://192.168.1.29/boss/?test=1' ]]
api_status=$(curl --noproxy '*' -ksS --resolve 192.168.1.29:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://192.168.1.29/boss/api/access)
[[ "$api_status" == 401 || "$api_status" == 403 ]]
curl --noproxy '*' -fsS http://127.0.0.1:3070/health >/dev/null
trap - ERR INT TERM
echo "切換成功，備份：$backup"
echo '舊 /srv/web/soyal 保留為指向 /srv/web/boss 的相容連結。'
if /usr/sbin/runuser -u indar -- /usr/bin/gh workflow run deploy.yml --repo 5871224/INDAR --ref main; then
  echo '已觸發首頁自動部署。'
else
  echo '網站已切換，但無法觸發首頁自動部署；請檢查 GitHub Actions。' >&2
fi
