#!/bin/sh
# Upgrade only installed, matching-architecture packages from the QModem Release.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
LC_ALL=C
export LC_ALL
umask 077
base=/tmp/qmodem-software-update
lock=/var/lock/qmodem-theme-update.lock
mkdir -p "$base"
state() {
 jq -cn --arg phase "$1" --argjson percent "$2" --arg message "${3:-}" '{phase:$phase,percent:$percent,message:$message}' >"$base/state.tmp"
 mv "$base/state.tmp" "$base/state.json"
}
fail() { state failed 0 "$1"; exit 1; }
installed_packages() {
 if [ "$format" = apk ]; then
  awk 'BEGIN{RS="";FS="\n"}{p="";v="";for(i=1;i<=NF;i++){if(substr($i,1,2)=="P:")p=substr($i,3);if(substr($i,1,2)=="V:")v=substr($i,3)}if(p!="")print p "\t" v}' /lib/apk/db/installed
 else
  awk 'BEGIN{RS="";FS="\n"}{p="";v="";ok=0;for(i=1;i<=NF;i++){if(substr($i,1,9)=="Package: ")p=substr($i,10);if(substr($i,1,9)=="Version: ")v=substr($i,10);if($i~/^Status: .* installed$/)ok=1}if(ok&&p!="")print p "\t" v}' /usr/lib/opkg/status
 fi
}
newer() {
 if [ "$format" = apk ]; then [ "$(apk version -t "$1" "$2" 2>/dev/null)" = '<' ]
 else opkg compare-versions "$1" lt "$2"; fi
}
platform_for_arch() {
 case "$1" in x86_64) echo x64;; aarch64_cortex-a53) echo arm64;; mipsel_24kc) echo mmips;; *) return 1;; esac
}
select_asset() {
 if [ -s /lib/apk/db/installed ] && command -v apk >/dev/null 2>&1; then
  format=apk; arch=$(apk --print-arch)
 elif [ -s /usr/lib/opkg/status ] && command -v opkg >/dev/null 2>&1; then
  format=ipk
  arch=$(opkg print-architecture | awk '$2!="all"&&$2!="noarch"&&$3+0>p{p=$3;a=$2}END{print a}')
 else fail '无法识别系统的 IPK/APK 包管理器'; fi
 platform=$(platform_for_arch "$arch") || fail "发布页没有与当前架构匹配的安装包：$arch"
 installed_packages >"$base/installed.tsv"
 installed=$(awk '$1=="qmodem"{print $2}' "$base/installed.tsv")
 [ -n "$installed" ] || fail '未安装 QModem，不能执行更新'
 curl -fsS --connect-timeout 5 --max-time 30 https://api.github.com/repos/czyjian/QModem/releases/latest >"$base/release.json" || fail '获取 QModem 发布信息失败'
 tag=$(jq -r '.tag_name//""' "$base/release.json"); available=${tag#v}
 printf '%s' "$available" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-r[0-9]+$' || fail '发布版本号无效'
 core_version=$(printf '%s' "$installed" | sed -E 's/-([0-9]+)$/-r\1/')
 if newer "$available" "$core_version"; then fail '当前 QModem 版本高于发布版，不执行旧版本更新'; fi
 filename="QModem-${platform}_${format}.tar.gz"
 asset=$(jq -c --arg name "$filename" '[.assets[]|select(.name==$name)]|if length==1 then .[0] else empty end' "$base/release.json")
 [ -n "$asset" ] || fail '此版本尚未提供匹配平台和包格式的安装包'
 url=$(printf '%s' "$asset" | jq -r '.browser_download_url')
 [ "$url" = "https://github.com/czyjian/QModem/releases/download/$tag/$filename" ] || fail '发布包下载地址无效'
 size=$(printf '%s' "$asset" | jq -r '.size'); digest=$(printf '%s' "$asset" | jq -r '.digest//""')
 printf '%s' "$size" | grep -Eq '^[0-9]+$' || fail '发布包大小无效'
 [ "$size" -gt 0 ] && [ "$size" -le 134217728 ] || fail '发布包大小超出限制'
 printf '%s' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail '发布包缺少 SHA256 校验信息'
}
metadata() {
 package_file="$1"
 if [ "$format" = apk ]; then
  apk adbdump "$package_file" >"$base/metadata" 2>/dev/null || return 1
  name=$(sed -n 's/^  name: //p' "$base/metadata" | head -1)
  version=$(sed -n 's/^  version: //p' "$base/metadata" | head -1)
  package_arch=$(sed -n 's/^  arch: //p' "$base/metadata" | head -1)
 else
  control=$(tar -tzf "$package_file" 2>/dev/null | grep -E '^(\./)?control.tar.gz$' | head -1)
  [ -n "$control" ] || return 1
  tar -xOzf "$package_file" "$control" >"$base/control.tar.gz" || return 1
  entry=$(tar -tzf "$base/control.tar.gz" | grep -E '^(\./)?control$' | head -1)
  [ -n "$entry" ] || return 1
  tar -xOzf "$base/control.tar.gz" "$entry" >"$base/metadata" || return 1
  name=$(sed -n 's/^Package: //p' "$base/metadata" | head -1)
  version=$(sed -n 's/^Version: //p' "$base/metadata" | head -1)
  package_arch=$(sed -n 's/^Architecture: //p' "$base/metadata" | head -1)
 fi
 printf '%s' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9+_.-]*$' || return 1
 printf '%s' "$version" | grep -Eq '^[0-9][A-Za-z0-9+_.~:-]*$' || return 1
 [ -n "$package_arch" ]
}
prepare_plan() {
 file="$base/$filename"
 tar -tzf "$file" >"$base/entries" || fail '发布压缩包无法读取'
 # Release archives contain regular, top-level package files only.
 while IFS= read -r entry; do
  printf '%s' "$entry" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9+_.~-]*\.(apk|ipk)$' || fail '发布压缩包包含无效路径'
  case "$entry" in *."$format") :;; *) fail '发布压缩包的安装格式不匹配';; esac
 done <"$base/entries"
 tar -tvzf "$file" | awk 'substr($0,1,1)!="-"{bad=1}END{exit bad}' || fail '发布压缩包包含非普通文件'
 mkdir -p "$base/packages"
 # A verified archive still must pass path/type checks before extraction.
 tar -xzf "$file" -C "$base/packages" || fail '解压发布包失败'
 : >"$base/plan.tsv"; : >"$base/skipped.tsv"; : >"$base/seen"
 while IFS= read -r entry; do
  path="$base/packages/$entry"
  metadata "$path" || fail "无法读取安装包信息：$entry"
  grep -Fxq "$name" "$base/seen" && fail "发布包包含重复组件：$name"
  printf '%s\n' "$name" >>"$base/seen"
  old=$(awk -F '\t' -v p="$name" '$1==p{print $2}' "$base/installed.tsv")
  if [ -z "$old" ]; then printf '%s\t未安装，跳过\n' "$name" >>"$base/skipped.tsv"; continue; fi
  case "$name" in kmod-*|kernel) printf '%s\t内核组件不更新\n' "$name" >>"$base/skipped.tsv"; continue;; esac
  case "$package_arch" in all|noarch|"$arch") :;; *) fail "已安装组件的更新包架构不匹配：$name ($package_arch)";; esac
  if newer "$old" "$version"; then
   printf '%s\t%s\t%s\t%s\n' "$name" "$old" "$version" "$path" >>"$base/plan.tsv"
  else printf '%s\t当前版本无需更新\n' "$name" >>"$base/skipped.tsv"; fi
 done <"$base/entries"
 [ -s "$base/plan.tsv" ] || fail '暂无版本更新'
 jq -Rn --arg platform "$platform" --arg arch "$arch" --arg format "$format" '[inputs|split("\t")|{name:.[0],current:.[1],available:.[2]}]|{platform:$platform,arch:$arch,format:$format,packages:.}' <"$base/plan.tsv" >"$base/plan.json"
}
preflight() {
 set --
 while IFS="$(printf '\t')" read -r name old version path; do set -- "$@" "$path"; done <"$base/plan.tsv"
 if [ "$format" = apk ]; then
  apk add --simulate --no-network --allow-untrusted "$@" >"$base/preflight.log" 2>&1
 else opkg --noaction --no-download install "$@" >"$base/preflight.log" 2>&1; fi
 result=$?
 # Reject *all* new installations, removals, downgrades and unrelated upgrades.
 awk '/^\([0-9]+\/[0-9]+\) / {if($2!="Upgrading"&&$2!="Reinstalling")print $3;else print "upgrade:"$3}
      /^(Installing|Removing|Downgrading) / {print $2}
      /^Upgrading / {print "upgrade:"$2}' "$base/preflight.log" >"$base/actions"
 blocked=''
 while IFS= read -r action; do
  case "$action" in upgrade:*) p=${action#upgrade:}; awk -F '\t' -v p="$p" '$1==p{ok=1}END{exit !ok}' "$base/plan.tsv" && continue;; esac
  blocked="$blocked $action"
 done <"$base/actions"
 [ -z "$blocked" ] || fail "更新需要新增、移除或改动清单外组件，已停止：$blocked"
 if [ "$result" -ne 0 ]; then
  if grep -Eq '^  (libubox|libubus|libblobmsg-json)[0-9]+' "$base/preflight.log"; then
   fail '发布包的系统库 ABI 与当前固件不匹配，更新已停止；不会自动升级系统库'
  fi
  missing=$(awk '/^  [A-Za-z0-9+_.-]+ \(no such package\):/{printf "%s ",$1}' "$base/preflight.log")
  [ -z "$missing" ] || fail "缺少依赖，更新已停止（不会自动安装）：$missing"
  fail '依赖或兼容性检查未通过，未执行安装；详情见更新日志'
 fi
 while IFS="$(printf '\t')" read -r name old version path; do
  grep -Fxq "upgrade:$name" "$base/actions" || fail "无法确认组件的安装计划，更新已停止：$name"
 done <"$base/plan.tsv"
 # Database changes between plan and install invalidate the plan.
 installed_packages >"$base/installed-now.tsv"
 cmp -s "$base/installed.tsv" "$base/installed-now.tsv" || fail '软件包清单已变化，请重新检查更新'
}
case "$1" in
status)
 if [ -s "$base/state.json" ]; then
  phase=$(jq -r '.phase' "$base/state.json")
  case "$phase" in downloading|installing)
   exec 8>"$lock"; if flock -n 8; then state failed 0 '更新进程已退出，请重试'; fi;;
  esac
  cat "$base/state.json"
 else echo '{"phase":"idle","percent":0}'; fi
 exit 0;;
start)
 exec 9>"$lock"
 if ! flock -n 9; then echo '{"started":false,"busy":true}'; exit 0; fi
 state downloading 0
 (trap '' HUP; exec /bin/sh "$0" run) </dev/null >"$base/worker.log" 2>&1 &
 echo '{"started":true}'; exit 0;;
probe)
 select_asset
 jq -cn --arg platform "$platform" --arg arch "$arch" --arg format "$format" --arg url "$url" '{platform:$platform,arch:$arch,format:$format,url:$url}'
 exit 0;;
run|verify) ;;
*) exit 1;;
esac
trap 'state failed 0 "更新进程被中断"; exit 1' HUP INT TERM
select_asset
file="$base/$filename"
: >"$file"
curl -fL --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 300 --max-filesize "$size" -o "$file" "$url" & download=$!
while kill -0 "$download" 2>/dev/null; do
 bytes=$(wc -c <"$file"); percent=$((bytes*100/size)); [ "$percent" -le 99 ] || percent=99
 state downloading "$percent"; sleep 1
done
wait "$download" || fail '下载发布包失败'
[ "$(wc -c <"$file")" -eq "$size" ] || fail '发布包下载不完整'
printf '%s  %s\n' "${digest#sha256:}" "$file" | sha256sum -c - || fail '发布包 SHA256 校验失败'
prepare_plan
preflight
if [ "$1" = verify ]; then state idle 0; cat "$base/plan.json"; exit 0; fi
state downloading 100; sleep 1
state installing 0
set --
while IFS="$(printf '\t')" read -r name old version path; do set -- "$@" "$path"; done <"$base/plan.tsv"
if [ "$format" = apk ]; then
 : >"$base/progress"
 apk add --wait 30 --no-network --allow-untrusted --progress-fd 3 "$@" 3>"$base/progress" >"$base/install.log" 2>&1 & install=$!
 while kill -0 "$install" 2>/dev/null; do
  percent=$(awk '/^[0-9]+$/{p=$1} $1~/^[0-9]+\/[0-9]+$/{split($1,a,"/");if(a[2]>0)p=int(a[1]*100/a[2])}END{print p+0}' "$base/progress")
  [ "$percent" -le 99 ] || percent=99
  state installing "$percent"; sleep 1
 done
 wait "$install" || fail '安装失败，请查看更新日志'
else
 state installing 25
 opkg --no-download install "$@" >"$base/install.log" 2>&1 || fail '安装失败，请查看更新日志'
 state installing 90
fi
installed_packages >"$base/installed-after.tsv"
while IFS="$(printf '\t')" read -r name old expected path; do
 actual=$(awk -F '\t' -v p="$name" '$1==p{print $2}' "$base/installed-after.tsv")
 [ "$actual" = "$expected" ] || fail "安装后版本校验失败：$name"
done <"$base/plan.tsv"
# No new package names may appear after the upgrade.
cut -f1 "$base/installed.tsv" | sort >"$base/names-before"
cut -f1 "$base/installed-after.tsv" | sort >"$base/names-after"
cmp -s "$base/names-before" "$base/names-after" || fail '更新后组件清单发生变化，请检查安装日志'
sync
rm -f /tmp/qmodem-update-check.json
state installing 100; sleep 1
state complete 100
