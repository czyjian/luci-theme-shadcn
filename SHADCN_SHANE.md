# Shadcn_Shane

基于 Shadcn 的蜂窝数据面板主题。正式包名为 `luci-theme-shadcn-shane`，LuCI 主题名称为 `Shadcn_Shane`，可与原版 Shadcn 共存。

面板包含模组状态、实时流量、蜂窝信号、主载波与聚合载波、上下行带宽、温度、电压、连接设备及网络接口。数据来自现有 QModem；无效载波带宽不参与拼接。接口图标按防火墙的 LAN/WAN 区域区分颜色，温度、电压始终位于信号卡片底部。

## 构建

在 `.dev` 目录运行 `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test`，然后在仓库根运行：

```sh
node scripts/stage-shane.mjs
```

将 `dist/luci-theme-shadcn-shane` 复制到 OpenWrt 构建树的 `package/`，运行：

```sh
make package/luci-theme-shadcn-shane/compile CONFIG_PACKAGE_luci-theme-shadcn-shane=m V=s -j2
```

暂存脚本为媒体目录、视图、模板、导航模块及 ACL 加独立命名空间。源码和生成资源仍沿用上游目录结构，发布包通过暂存脚本生成。GitHub 构建工作流采用同一路径。

## 安装和切换

安装正式 APK 后，在 LuCI 的“系统 → 系统 → 语言和界面”选择 `Shadcn_Shane`，或执行：

```sh
uci set luci.main.mediaurlbase='/luci-static/shadcn-shane'
uci commit luci
```

确认正式主题正常后，可移除 `luci-theme-shadcn-test` 并删除旧的 `luci.themes.Shadcn_CPE_Test` 注册项。正式包保留 `admin/cpe` 面板地址。卸载正式包前应先切换到其他已安装主题。
