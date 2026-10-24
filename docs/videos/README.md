# 演示视频

## 主视频

| 项目 | 值 |
| --- | --- |
| 文件 | [`maimen-huican-demo.mp4`](maimen-huican-demo.mp4) |
| 时长 | 135.04 秒（2 分 15 秒） |
| 分辨率 / 帧率 | 1280 × 720，25 fps |
| 编码 | H.264（High profile，yuv420p，bt709），MP4，`+faststart` |
| 大小 | 3.46 MB（3,455,072 字节） |
| SHA256 | `026f8735eefb2b4ff254417a375f5dad685d0a2d4be50e878d222c78daa0a12a` |
| 录制时间 | 2026-10-24 22:59—23:01（Asia/Shanghai） |
| 录制方式 | Playwright 驱动本机 `http://127.0.0.1:4192/` 的真实页面，用 `recordVideo` 录制；脚本 `test/record-demo.mjs` |
| 数据性质 | **真实麦当劳 MCP 调用**：真实门店、88 个可用单品、3 个门店优惠、官方价格试算；不是 mock，也不是截图合成 |
| 字幕 | 中文硬字幕，录制时叠加在页面底部（constructed stylesheet），无配音、无音轨 |
| 剪辑 | 未剪辑、未变速；等待过程原样保留 |
| 隐私 | 只有本项目窗口；不含 Token、Cookie、手机号、券码、收货地址 |

录制顺序：片头一句问题 → 连接与独立配置入口 → 公开商圈「上海 / 静安寺」查门店 → 两张匿名需求卡（并展示 1—4 人）→ 四种策略与逐人满足情况 → 匿名 B 否决自己分到的餐品并重排、重核价 → 预算收紧到 55 元后“多 10 元能换来什么” → 选择并导出 → 打开导出的 JSON 核对 → 边界说明（只查询与试算，不下单）。

说明：录制完成后仅调整了“价格说明换行”的 CSS，功能、数据与文案未变；因此视频里的价格说明在窄卡片内可能换行，与当前仓库渲染略有差别。

## 复核方式

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,avg_frame_rate,pix_fmt \
  -of default=nw=1 docs/videos/maimen-huican-demo.mp4
shasum -a 256 docs/videos/maimen-huican-demo.mp4
```

抽帧检查（开头 / 中间 / 结尾）：

```bash
for t in 2 55 92 132; do ffmpeg -v error -ss $t -i docs/videos/maimen-huican-demo.mp4 -frames:v 1 /tmp/f$t.png -y; done
```

## 没有单独录制的内容

- `negotiation-demo.mp4` 未单独录制：否决重排与相邻预算对比已经并入主视频，不再单独剪一条。
- 早期录制的三版 webm（字幕不可见 / 布局未完成）已删除，只保留最终 MP4，避免把中间产物当作成品。
