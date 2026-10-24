# 演示视频

## 主视频（0.5.0 红黄主题版）

| 项目 | 值 |
| --- | --- |
| 文件 | [`maimen-huican-demo.mp4`](maimen-huican-demo.mp4) |
| 时长 | 148.52 秒（2 分 28 秒） |
| 分辨率 / 帧率 | 1280 × 720，25 fps |
| 编码 | H.264（High profile，level 4.0，yuv420p，bt709，TV range），MP4，`+faststart`，无音轨 |
| 大小 | 4,425,757 字节（4.22 MiB / 4.43 MB） |
| SHA256 | `65932b7b52ffa1553368a10d1eea38725077469d2e6de11e5eab711495299347` |
| 录制时间 | 2026-10-24 23:45—23:48（Asia/Shanghai），23:48 转码 |
| 录制方式 | Playwright 驱动本机 `http://127.0.0.1:4192/` 的真实页面，`recordVideo` 录制；脚本 `test/record-demo.mjs` |
| 数据性质 | **真实麦当劳 MCP 调用**：真实门店（5 家可选，选「麦当劳上海静安寺餐厅」）、真实菜单与门店优惠、官方价格试算；不是 mock，也不是截图拼接 |
| 画面来源 | 全部为浏览器实际渲染与脚本实际点击；片头/片尾/导出核对卡是同源页面真实渲染的静态卡片，不是把截图拼成交互 |
| 字幕 | 中文硬字幕，录制时叠加在页面底部；顶部有「浏览器自动操作录制 · 真实页面」角标；无配音、无音轨 |
| 剪辑 | 未剪辑、未变速；官方查询与试算的真实等待原样保留 |
| 主题 | 片头、片尾、导出核对卡、字幕底色与角标均为同一套红黄（`#DA291C` / `#FFC72C` / `#FFF9ED`） |
| 隐私 | 只有本项目窗口；不含 Token、Cookie、手机号、券码、收货地址 |

录制顺序：片头 → 新版首页 → 连接状态与独立配置入口 → 公开商圈「上海 / 静安寺」查门店 → 两张匿名需求卡（并展示 1—4 人）→ 四种策略与逐人满足情况 → 匿名 B 否决自己分到的「高达吉士双牛堡」并重排、重核价 → 预算收紧到 55 元后“多 10 元能换来什么”（真实差额 ¥14.00，新增麦乐鸡 ×1，受益人为匿名 A）→ 选择并导出 → 打开导出的 JSON 核对（优先满足口味，官方实付 ¥46.50，两人 1/0/1）→ 边界说明（只查询与试算，不下单）。

### 与旧版（0.4.0）的差别

- 旧版片头/片尾/导出卡是深绿，网页是浅绿；0.5.0 全部换成红黄，视频与封面、网页一致。
- 旧版片头在录像里只绘制左上角一块，露出灰色底；原因是把卡片 `setContent` 写进空白页，录屏只拿到一小块渲染面。新版改为导航到被 route 拦截的同源地址 `/__demo-card`，抽帧检查开头/中间/结尾灰边占比均为 **0%**。
- 旧版 2 分 15 秒、3.46 MB；新版 2 分 28 秒、4.22 MiB。旧原片不随仓库发布。

## 复核方式

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,profile,width,height,avg_frame_rate,pix_fmt,color_range \
  -of default=nw=1 docs/videos/maimen-huican-demo.mp4
shasum -a 256 docs/videos/maimen-huican-demo.mp4
```

抽帧检查（开头 / 中间 / 结尾），并核对没有灰边：

```bash
for t in 1 3 75 110 144; do ffmpeg -v error -ss $t -i docs/videos/maimen-huican-demo.mp4 -frames:v 1 -y /tmp/f$t.png; done
```

## 截图

新版页面的实际截图（同一份真实方案结果，1280×900 / 390×844）：

- `outputs/screenshots/desktop-01-home.png`、`desktop-02-plans.png`、`desktop-03-plans-detail.png`
- `outputs/screenshots/mobile-01-home.png`、`mobile-02-form.png`、`mobile-03-plans.png`

## 没有单独录制的内容

- `negotiation-demo.mp4` 未单独录制：否决重排与相邻预算对比已经并入主视频。
- 演示模式（虚构数据）没有录进主视频，避免与真实调用混淆；它只在界面与测试里验证。
- 旧版深绿视频已从仓库移除，避免 README 指向过期版本。
