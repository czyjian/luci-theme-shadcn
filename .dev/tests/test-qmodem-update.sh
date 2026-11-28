#!/bin/sh
# Run on OpenWrt: sh test-qmodem-update.sh /path/to/qmodem_update.sh
set -eu
updater=$1
fixture=/tmp/qmodem-update-tests.$$
mkdir -p "$fixture"
sed '/^case "$1" in/,$d' "$updater" | sed "s@^base=.*@base=$fixture@" >"$fixture/functions"
. "$fixture/functions"
trap 'case "$base" in /tmp/qmodem-update-tests.*) rm -rf "$base";; esac' EXIT
[ "$(platform_for_arch x86_64)" = x64 ]
[ "$(platform_for_arch aarch64_cortex-a53)" = arm64 ]
[ "$(platform_for_arch mipsel_24kc)" = mmips ]
if platform_for_arch aarch64_generic; then exit 1; fi
# Real IPK control parsing, including legacy version spelling.
format=ipk
mkdir "$base/control" "$base/envelope"
printf 'Package: qmodem\nVersion: 3.4.1-278\nArchitecture: x86_64\n' >"$base/control/control"
tar -czf "$base/envelope/control.tar.gz" -C "$base/control" ./control
tar -czf "$base/sample.ipk" -C "$base/envelope" ./control.tar.gz
metadata "$base/sample.ipk"
[ "$name" = qmodem ] && [ "$version" = 3.4.1-278 ] && [ "$package_arch" = x86_64 ]
# Plan uses metadata plus installed-name intersection, not a plugin prefix.
metadata() { IFS=' ' read -r name version package_arch <"$1"; }
format=apk; arch=x86_64; platform=x64; filename=release.tar.gz
mkdir "$base/archive"
printf 'qmodem 3.4.1-r278 x86_64\n' >"$base/archive/qmodem-3.4.1-r278.apk"
printf 'luci-app-qmodem-voip 3.4.1-r278 all\n' >"$base/archive/luci-app-qmodem-voip-3.4.1-r278.apk"
printf 'qmodem-sipd 3.4.1-r278 x86_64\n' >"$base/archive/qmodem-sipd-3.4.1-r278.apk"
printf 'kmod-example 3.4.1-r278 x86_64\n' >"$base/archive/kmod-example-3.4.1-r278.apk"
printf 'qmodem\t3.4.0_rc3-r278\nkmod-example\t3.4.0_rc3-r1\n' >"$base/installed.tsv"
tar -czf "$base/$filename" -C "$base/archive" qmodem-3.4.1-r278.apk luci-app-qmodem-voip-3.4.1-r278.apk qmodem-sipd-3.4.1-r278.apk kmod-example-3.4.1-r278.apk
prepare_plan
[ "$(wc -l <"$base/plan.tsv")" -eq 1 ]
[ "$(cut -f1 "$base/plan.tsv")" = qmodem ]
grep -q 'luci-app-qmodem-voip' "$base/skipped.tsv"
grep -q 'qmodem-sipd' "$base/skipped.tsv"
# Already installed VoIP gets upgraded; it is never forcibly omitted.
printf 'luci-app-qmodem-voip\t3.4.0_rc3-r1\n' >>"$base/installed.tsv"
prepare_plan
[ "$(wc -l <"$base/plan.tsv")" -eq 2 ]
# Wrong architecture of an installed package must stop before installation.
printf 'qmodem 3.4.1-r278 aarch64_cortex-a53\n' >"$base/archive/qmodem-3.4.1-r278.apk"
tar -czf "$base/$filename" -C "$base/archive" qmodem-3.4.1-r278.apk
if (prepare_plan); then echo 'wrong architecture accepted'; exit 1; fi
# Dependency solver guard rejects additions, removals and unrelated upgrades.
printf 'qmodem\t3.4.0_rc3-r278\t3.4.1-r278\t/tmp/qmodem.apk\n' >"$base/plan.tsv"
installed_packages() { cat "$base/installed.tsv"; }
apk() { case "$*" in *--simulate*) cat "$base/solver";; *) echo 'unexpected real install' >&2; return 99;; esac; }
printf '(1/1) Upgrading qmodem (3.4.0_rc3-r278 -> 3.4.1-r278)\n' >"$base/solver"
preflight
for line in '(1/1) Installing voipd (1)' '(1/1) Upgrading busybox (1 -> 2)' '(1/1) Purging qmodem (1)' '(1/1) Downgrading qmodem (2 -> 1)'; do
 printf '%s\n' "$line" >"$base/solver"
 if (preflight); then echo "unsafe solver plan accepted: $line"; exit 1; fi
done
echo 'Architecture, IPK metadata, installed-plugin selection, existing VoIP upgrades and no-add/no-remove guards passed'
