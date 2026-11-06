#!/usr/bin/env bash
set -Eeuo pipefail

revision=${1:?A commit SHA is required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
repo=/home/indar/deploy/INDAR-SOYAL
target=/srv/web/boss
service=indar-soyal.service
exec 9>/home/indar/.deploy-indar-boss.lock
flock -n 9 || { echo 'Another BOSS deployment is running.' >&2; exit 1; }

test -d "$repo/.git"
test -d "$target/pages"
test -z "$(git -C "$repo" status --porcelain)" || { echo 'Deployment checkout has local changes.' >&2; exit 1; }
git -C "$repo" fetch --no-tags origin main
latest=$(git -C "$repo" rev-parse FETCH_HEAD)
if [[ "$revision" != "$latest" ]]; then
  echo "Skipping obsolete revision $revision; main is $latest."
  exit 0
fi
previous=$(git -C "$repo" rev-parse HEAD)
backup=$(mktemp -d /home/indar/deploy/.boss-rollback.XXXXXX)
rsync -a "$target/" "$backup/"
backend_changed=false
if ! git -C "$repo" diff --quiet "$previous" "$revision" -- server.mjs package.json package-lock.json; then
  backend_changed=true
fi

restart_backend() {
  local old_pid pid
  old_pid=$(systemctl show --property MainPID --value "$service")
  [[ "$old_pid" =~ ^[1-9][0-9]*$ ]] || { echo 'BOSS service is not running.' >&2; return 1; }
  [[ "$(ps -o user= -p "$old_pid" | xargs)" == "$(id -un)" ]] || return 1
  kill -KILL "$old_pid"
  for _ in {1..30}; do
    sleep 1
    pid=$(systemctl show --property MainPID --value "$service")
    if [[ "$pid" =~ ^[1-9][0-9]*$ && "$pid" != "$old_pid" ]] && systemctl is-active --quiet "$service" && curl --noproxy '*' -fsS --max-time 3 http://127.0.0.1:3070/health >/dev/null; then return 0; fi
  done
  echo 'BOSS service did not recover.' >&2
  return 1
}

rollback() {
  local code=$?
  trap - ERR
  echo 'Deployment failed; restoring previous files.' >&2
  git -C "$repo" reset --hard "$previous" || true
  rsync -a --delete "$backup/" "$target/" || true
  if [[ "$backend_changed" == true ]]; then
    npm ci --omit=dev --ignore-scripts --prefix "$repo" || true
    restart_backend || true
  fi
  echo "Backup retained at $backup" >&2
  exit "$code"
}
trap rollback ERR

git -C "$repo" reset --hard "$revision"
if [[ "$backend_changed" == true ]]; then
  npm ci --omit=dev --ignore-scripts --prefix "$repo"
  restart_backend
fi
rsync -a --delete "$repo/pages/" "$target/pages/"
install -m 0644 "$repo/index.html" "$target/.index.html.new"
mv -f "$target/.index.html.new" "$target/index.html"
curl --noproxy '*' -fsS --max-time 5 http://127.0.0.1:3070/health >/dev/null
curl --noproxy '*' -kfsS --max-time 10 --resolve 192.168.1.29:443:127.0.0.1 https://192.168.1.29/boss/ | cmp - "$repo/index.html"
trap - ERR
rm -rf "$backup"
echo "Deployed INDAR-BOSS $revision"
