# 5G CPE 面板

保留 Shadcn 的导航、色调和组件样式，增加只读的移动网络面板，入口为 `/cgi-bin/luci/admin/cpe`。

- 模组、运营商、网络模式、信号质量和载波信息。
- 实时上下行曲线、今日蜂窝接口用量、连接跟踪总数、内存和运行时间。
- 下载使用蓝色实线，上传使用橙色虚线；图例和数值同步配色。
- 鼠标悬停或使用左右方向键查看采样时间、双向速率和定位标记。
- 读取 QModem 保存的最近 60 个采样点，重新打开面板时恢复历史，采样空档不连线。
- 监测接口显示逻辑接口名称，例如 `2_1`，保留底层网口用于实际计数。
- 局域网活跃设备、网络接口和 QModem 快捷入口。
- 独立天线图标；全宽布局；浅色和深色模式。

蜂窝信息每 10 秒读取，面板每 3 秒更新。依赖设备已配置的 QModem；缺少数据时显示占位或状态提示，不修改拨号、频段或 SIM 配置。流量服务不可用时，实时速率使用所选网口计数器计算。

设备列表依据 `lan` 接口的 ARP/NDP 活跃状态，按 MAC 合并 IPv4/IPv6，用 DHCP 租约补充名称；休眠设备可能暂时不显示。总连接数读取内核连接跟踪表，包含 TCP、UDP 等协议，不代表设备数量。

## 构建测试包

```sh
cd .dev
pnpm install --frozen-lockfile
pnpm build
pnpm test
cd ..
node scripts/stage-test.mjs
```

暂存源码位于 `dist/luci-theme-shadcn-test`。将其放入 OpenWrt/ImmortalWrt 构建树的 `package/luci-theme-shadcn-test`，执行：

```sh
make package/luci-theme-shadcn-test/compile CONFIG_PACKAGE_luci-theme-shadcn-test=m V=s
```

测试包的资源、模板和菜单独立命名，可与正式 Shadcn 共存；安装后注册 `Shadcn_CPE_Test`，需在系统设置中选择主题。APK、构建暂存目录和本地设备测试记录不提交到仓库。

## OpenClash 浅色日志修复

针对 [Issue #9](https://github.com/eamonxg/luci-theme-shadcn/issues/9)，仅在 OpenClash 页面将背景色表达为由原始 Shadcn token 转换的等值 sRGB，让 OpenClash 正确识别明暗模式。原有 OKLCH 色彩系统和 OpenClash 文件保持不变。

构建时自动生成兼容样式；回归测试覆盖明暗判断和颜色一致性。侧栏测试还覆盖跳转到直达入口时清除旧分类展开状态。
