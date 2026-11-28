#
# Copyright (C) 2026 eamonxg <eamonxiong@gmail.com>
# Licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=A modern sidebar LuCI theme for OpenWrt, built with shadcn/ui design language.
LUCI_DEPENDS:=+luci-base +curl +jq +flock

PKG_VERSION:=0.6.3
PKG_RELEASE:=2026112803
PKG_LICENSE:=Apache-2.0

LUCI_MINIFY_CSS:=
CONFIG_LUCI_CSSTIDY:=

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

