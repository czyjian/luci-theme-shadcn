#!/bin/sh
# Only installs the matching theme package from the fixed official project Release.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
base=/tmp/qmodem-theme-update
mkdir -p "$base"
state() {
 jq -cn --arg phase "$1" --argjson percent "$2" --arg message "${3:-}" '{phase:$phase,percent:$percent,message:$message}' >"$base/state.tmp"
 mv "$base/state.tmp" "$base/state.json"
}
fail() { state failed 0 "$1"; exit 1; }
version() {
 if [ "$format" = apk ]; then
  awk -v name="$1" 'BEGIN{RS="";FS="\n"}{p="";v="";for(i=1;i<=NF;i++){if($i=="P:"name)p=name;if(substr($i,1,2)=="V:")v=substr($i,3)}if(p!=""){print v;exit}}' /lib/apk/db/installed
 else opkg status "$1" 2>/dev/null | sed -n 's/^Version: //p' | head -1; fi
}
select_asset() {
 # Select by the active package database, not merely a leftover executable.
 if [ -s /lib/apk/db/installed ] && command -v apk >/dev/null 2>&1; then format=apk
 elif [ -s /usr/lib/opkg/status ] && command -v opkg >/dev/null 2>&1; then format=ipk
 else fail '无法识别系统的 IPK/APK 包管理器'; fi
 package=luci-theme-shadcn-shane
 installed=$(version "$package")
 if [ -z "$installed" ]; then package=luci-theme-shadcn; installed=$(version "$package"); fi
 [ -n "$installed" ] || fail '未找到已安装的 shadcn 主题'
 curl -fsS --connect-timeout 5 --max-time 30 https://api.github.com/repos/czyjian/luci-theme-shadcn/releases/latest >"$base/release.json" || fail '获取发布信息失败'
 tag=$(jq -r '.tag_name//""' "$base/release.json"); available=${tag#v}
 printf '%s' "$available" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-r[0-9]+$' || fail '发布版本号无效'
 if [ "$format" = apk ]; then
  [ "$(apk version -t "$installed" "$available")" = '<' ] || fail '暂无版本更新'
  filename="$package-$available.apk"
 else
  opkg compare-versions "$installed" lt "$available" || fail '暂无版本更新'
  filename="${package}_${available}_all.ipk"
 fi
 asset=$(jq -c --arg name "$filename" '[.assets[]|select(.name==$name)]|if length==1 then .[0] else empty end' "$base/release.json")
 [ -n "$asset" ] || fail '此版本未提供与当前系统匹配的安装包'
 url=$(printf '%s' "$asset" | jq -r '.browser_download_url')
 [ "$url" = "https://github.com/czyjian/luci-theme-shadcn/releases/download/$tag/$filename" ] || fail '安装包下载地址无效'
 size=$(printf '%s' "$asset" | jq -r '.size'); digest=$(printf '%s' "$asset" | jq -r '.digest//""')
 printf '%s' "$size" | grep -Eq '^[0-9]+$' || fail '安装包大小无效'
 [ "$size" -gt 0 ] && [ "$size" -le 52428800 ] || fail '安装包大小超出限制'
 printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail '发布包缺少 SHA256 校验信息'
}
case "$1" in
status)
 if [ -s "$base/state.json" ]; then
  phase=$(jq -r '.phase' "$base/state.json")
  case "$phase" in downloading|installing)
   exec 8>/var/lock/qmodem-theme-update.lock
   if flock -n 8; then state failed 0 '更新进程已退出，请重试'; fi;;
  esac
  cat "$base/state.json"
 else echo '{"phase":"idle","percent":0}'; fi
 exit 0;;
start)
 exec 9>/var/lock/qmodem-theme-update.lock
 if ! flock -n 9; then echo '{"started":false,"busy":true}'; exit 0; fi
 state downloading 0
 (trap '' HUP; exec /bin/sh "$0" run) </dev/null >"$base/worker.log" 2>&1 &
 echo '{"started":true}'
 exit 0;;
probe)
 select_asset
 jq -cn --arg format "$format" --arg package "$package" --arg version "$available" --arg url "$url" --arg digest "$digest" '{format:$format,package:$package,version:$version,url:$url,digest:$digest}'
 exit 0;;
run|verify) ;;
*) exit 1;;
esac
trap 'state failed 0 "更新进程被中断"; exit 1' HUP INT TERM
select_asset
file="$base/$filename"
rm -f "$file"
: >"$file"
curl -fL --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 300 --max-filesize "$size" -o "$file" "$url" & download=$!
while kill -0 "$download" 2>/dev/null; do
 bytes=$(wc -c <"$file" 2>/dev/null); bytes=${bytes:-0}
 percent=$((bytes*100/size)); [ "$percent" -le 99 ] || percent=99
 state downloading "$percent"
 sleep 1
done
wait "$download" || fail '下载失败，请重试'
[ "$(wc -c <"$file")" -eq "$size" ] || fail '下载的安装包不完整'
printf '%s  %s\n' "${digest#sha256:}" "$file" | sha256sum -c - || fail '安装包 SHA256 校验失败'
if [ "$1" = verify ]; then
 if [ "$format" = apk ]; then apk add --simulate --allow-untrusted "$file" || fail '安装检查失败'
 else opkg --noaction install "$file" || fail '安装检查失败'; fi
 rm -f "$file"
 state idle 0
 echo 'Download, checksum and installation simulation passed'
 exit 0
fi
state downloading 100
sleep 1
state installing 0
if [ "$format" = apk ]; then
 # The package manager reports real installation percentages to this fd.
 : >"$base/progress"
 apk add --simulate --allow-untrusted "$file" >"$base/preflight.log" 2>&1 || fail '安装检查失败，请检查可用空间和软件包依赖'
 apk add --wait 30 --allow-untrusted --progress-fd 3 "$file" 3>"$base/progress" >"$base/install.log" 2>&1 & install=$!
 while kill -0 "$install" 2>/dev/null; do
  percent=$(tr '\r' '\n' <"$base/progress" | grep -E '^[0-9]+$' | tail -1); percent=${percent:-0}
  [ "$percent" -le 99 ] || percent=99
  state installing "$percent"
  sleep 1
 done
 wait "$install" || fail '安装失败，请查看更新日志'
else
 # opkg has no byte progress; report completed installation stages.
 opkg --noaction install "$file" >"$base/preflight.log" 2>&1 || fail '安装检查失败，请检查可用空间和软件包依赖'
 state installing 25
 opkg install "$file" >"$base/install.log" 2>&1 || fail '安装失败，请查看更新日志'
 state installing 90
fi
[ "$(version "$package")" = "$available" ] || fail '安装后版本校验失败'
sync
rm -f /tmp/qmodem-update-check.json
state installing 100
sleep 1
state complete 100
rm -f "$file"
