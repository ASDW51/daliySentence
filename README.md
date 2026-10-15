# 📖 每日一句 · Daily Sentence

每天积累一句中英双语金句，按月归档，慢慢攒成一本可以随时翻阅的小册子。

数据来自 [金山词霸 · 每日一句](http://open.iciba.com/dsapi/) · 归档正文在 [`sentences/`](sentences/README.md)

<!-- STATS:START -->
> **累计 1750 条** ｜ 覆盖 **58 个月**（2022/01 – 2026/10） ｜ 每月 1 号自动补齐上月
<!-- STATS:END -->

## ✨ 最新一句

<!-- LATEST:START -->
### 2026/10/16

> Bread tastes better when it is shared.
>
> 一起分享的面包，格外香甜。

[🖼 配图](https://staticedu-wps-cache.iciba.com/image/32ee8fa4eedde07fb04cd170c14773f0.png) · [🎧 朗读](https://staticedu-wps-cache.iciba.com/audio/624e4b322c4983302e21a54baddb3fee.mp3)

[查看 2026 年 10 月全部 16 条 →](sentences/2026/10.md)
<!-- LATEST:END -->

## 📚 归档目录

<!-- ARCHIVE:START -->
| 年份 | 月份（点击进入） | 条数 |
| :---: | :--- | ---: |
| **2026** | [01](sentences/2026/01.md) · [02](sentences/2026/02.md) · [03](sentences/2026/03.md) · [04](sentences/2026/04.md) · [05](sentences/2026/05.md) · [06](sentences/2026/06.md) · [07](sentences/2026/07.md) · [08](sentences/2026/08.md) · [09](sentences/2026/09.md) · [10](sentences/2026/10.md) | 289 |
| **2025** | [01](sentences/2025/01.md) · [02](sentences/2025/02.md) · [03](sentences/2025/03.md) · [04](sentences/2025/04.md) · [05](sentences/2025/05.md) · [06](sentences/2025/06.md) · [07](sentences/2025/07.md) · [08](sentences/2025/08.md) · [09](sentences/2025/09.md) · [10](sentences/2025/10.md) · [11](sentences/2025/11.md) · [12](sentences/2025/12.md) | 365 |
| **2024** | [01](sentences/2024/01.md) · [02](sentences/2024/02.md) · [03](sentences/2024/03.md) · [04](sentences/2024/04.md) · [05](sentences/2024/05.md) · [06](sentences/2024/06.md) · [07](sentences/2024/07.md) · [08](sentences/2024/08.md) · [09](sentences/2024/09.md) · [10](sentences/2024/10.md) · [11](sentences/2024/11.md) · [12](sentences/2024/12.md) | 366 |
| **2023** | [01](sentences/2023/01.md) · [02](sentences/2023/02.md) · [03](sentences/2023/03.md) · [04](sentences/2023/04.md) · [05](sentences/2023/05.md) · [06](sentences/2023/06.md) · [07](sentences/2023/07.md) · [08](sentences/2023/08.md) · [09](sentences/2023/09.md) · [10](sentences/2023/10.md) · [11](sentences/2023/11.md) · [12](sentences/2023/12.md) | 365 |
| **2022** | [01](sentences/2022/01.md) · [02](sentences/2022/02.md) · [03](sentences/2022/03.md) · [04](sentences/2022/04.md) · [05](sentences/2022/05.md) · [06](sentences/2022/06.md) · [07](sentences/2022/07.md) · [08](sentences/2022/08.md) · [09](sentences/2022/09.md) · [10](sentences/2022/10.md) · [11](sentences/2022/11.md) · [12](sentences/2022/12.md) | 365 |
| **合计** | 58 个月 | **1750** |
<!-- ARCHIVE:END -->

## 📂 目录结构

```text
.
├── README.md              # 本文件：统计 / 最新一句 / 归档目录
├── daily-sentence.mjs     # 采集脚本（Node.js ≥ 18，零依赖，幂等）
├── .gitignore             # 忽略本地抓取缓存 .cache/
├── sentences/             # 归档正文，按「年/月」拆分
│   ├── README.md          # 归档总览（自动生成）
│   ├── 2022/07.md         # 每个月一个文件
│   └── 2026/10.md
└── .github/workflows/
    └── monthly.yml        # 每月 1 号自动补齐上月数据
```

## 🤖 自动化

| 触发方式 | 时间 | 行为 |
| :--- | :--- | :--- |
| `schedule` | 每月 1 号 `00:00 UTC`（北京时间 08:00） | 抓取**上个月**整月数据并更新归档 |
| `workflow_dispatch` | 手动触发 | 可填 `from` / `to` 回补任意区间 |

默认模式是**自愈**的：脚本从「归档里最后一条的次日」补到「上个月最后一天」，
所以就算某几个月漏跑了，下一次运行也会自动补齐，不会留下空洞。

## 🔁 重复运行不会写重复数据

- 记录以**日期为唯一键**写入 `sentences/YYYY/MM.md`：同一天已存在就**覆盖**，不存在才追加，
  因此永远不会出现两条相同日期的记录。
- 内容与磁盘完全一致时连文件都不重写；工作流提交前先 `git add -A` 再 `git diff --cached --quiet`
  判断，没有变化就直接跳过提交，不会产生空提交。
- 工作流**只监听 `schedule` 和 `workflow_dispatch`，不监听 `push`**，
  并用 `concurrency` 保证同一时刻只有一个实例在改动归档。
- 所以一天内无论被触发多少次（定时、手动重跑、并发），归档结果都完全一致。

## 📝 说明

- 数据来源为金山词霸「每日一句」公开接口，仅作个人学习记录使用。
- 配图取自接口的 `fenxiang_img` 字段（词霸为每日一句专门排版的分享图），
  朗读音频取自 `tts`；两者都是 iciba CDN 直链，失效时不影响正文阅读。
- 归档起始于 `2022-07-21`，为连续数据，没有缺失日期。

## 🛠 本地使用

```bash
node daily-sentence.mjs                          # 补齐到上个月最后一天
node daily-sentence.mjs --date 2026-10-15        # 只抓某一天
node daily-sentence.mjs --month 2026-09          # 抓某个月
node daily-sentence.mjs --from 2022-07-21 --to 2026-10-16   # 区间回补
node daily-sentence.mjs --rebuild-index          # 只重建索引
node daily-sentence.mjs --check                  # 体检归档连续性
node daily-sentence.mjs --dry-run                # 演练，不写任何文件
```
