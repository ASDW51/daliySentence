#!/usr/bin/env node
/**
 * 每日一句 · 归档采集脚本（Node.js >= 18，无第三方依赖）
 *
 * 数据源：金山词霸「每日一句」 http://open.iciba.com/dsapi/?date=YYYY-MM-DD
 *
 * 归档结构：
 *   sentences/YYYY/MM.md    每月一个文件，每条以 `## YYYY/MM/DD` 为标题
 *   README.md               导航页（统计 / 最新一句 / 归档目录，仅改写标记块）
 *   sentences/README.md     归档总览（整份自动生成）
 *
 * 三个关键特性：
 *   1. 幂等   —— 同一天重复抓取只会覆盖同一条记录，永远不会出现两条相同日期。
 *                内容完全一致时连文件都不重写，因此 git 里不会产生空提交。
 *   2. 可回补 —— 接口支持指定日期，任何历史日期都能用 --date / --month / --from..--to 抓。
 *   3. 自愈   —— 默认模式从「归档中最后一条 + 1 天」补到「上个月最后一天」，
 *                就算漏跑了好几个月，下次运行也会自动补齐，不留空洞。
 *
 * 用法：
 *   node daily-sentence.mjs                                    # 默认：补齐到上个月最后一天
 *   node daily-sentence.mjs --date 2026-10-15                  # 只抓某一天
 *   node daily-sentence.mjs --month 2026-09                    # 抓某个月
 *   node daily-sentence.mjs --from 2022-07-21 --to 2026-10-16  # 区间回补
 *   node daily-sentence.mjs --rebuild-index                    # 只重建索引
 *   node daily-sentence.mjs --check                            # 只体检归档连续性
 *   node daily-sentence.mjs --dry-run                          # 演练，不写任何文件
 */

import { parseArgs } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- 常量

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SENTENCES_DIR = path.join(ROOT, "sentences");
const ROOT_README = path.join(ROOT, "README.md");
const ARCHIVE_README = path.join(SENTENCES_DIR, "README.md");
const CACHE_DIR = path.join(ROOT, ".cache", "dsapi");

/** 归档起始日期：仓库里第一条记录的日期 */
const ARCHIVE_START = "2022-07-21";

const API_BASE = "http://open.iciba.com/dsapi/";
const API_DOC = "http://open.iciba.com/dsapi/";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 daily-sentence-archive";

/** 月份文件里的日期标题，例如 `## 2026/10/15` */
const DATE_HEADING = /^##\s+(\d{4}\/\d{2}\/\d{2})\s*$/gm;

// ---------------------------------------------------------------- 小工具

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  if (!FLAGS.quiet) console.log(...args);
}
/** 关键结果始终输出，不受 --quiet 影响 */
function report(...args) {
  console.log(...args);
}
function warn(...args) {
  console.error(...args);
}

/** 北京时间（固定 UTC+8，中国无夏令时，不需要 tzdata） */
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(s, label) {
  if (!DATE_RE.test(s)) throw new Error(`${label} 格式应为 YYYY-MM-DD，收到：${s}`);
  return s;
}

function toUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtUTC(dt) {
  return dt.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = toUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtUTC(d);
}
/** 某年某月的天数 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** 上个月的最后一天；今天是 2026-10-16 → 2026-09-30 */
function lastDayOfPreviousMonth(today) {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1)); // 本月 1 号
  d.setUTCDate(0); // 回退到上月最后一天
  return fmtUTC(d);
}
function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = daysInMonth(y, m);
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(last).padStart(2, "0")}`,
  };
}
function listDates(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
function ymOf(dateStr) {
  return dateStr.slice(0, 7);
}

// ---------------------------------------------------------------- 抓取

async function fetchOnce(date) {
  const url = `${API_BASE}?date=${date}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Referer: "http://open.iciba.com/" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = (await res.text()).trim();

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 未来日期 / 越界日期会返回 200 + 纯文本「参数不合法」
  if (!text.startsWith("{")) throw new Error(`接口返回非 JSON：${text.slice(0, 40)}`);

  const json = JSON.parse(text);
  if (!json.content || !json.note) {
    throw new Error("接口缺少 content / note 字段");
  }
  // 上游有极少数记录的 dateline 字段是错的（已验证 sid 与请求日期严格逐日对应、
  // content 正确，仅 dateline 被写错），所以这里只提示、不报错：
  // 归档一律以「请求的日期」为准，dateline 不参与定位。
  if (json.dateline !== date) {
    warn(
      `[note] ${date} 的 dateline 字段异常（返回 ${json.dateline ?? "空"}），已按请求日期归档`,
    );
  }
  return json;
}

async function fetchWithCache(date, { refresh = false } = {}) {
  const cacheFile = path.join(CACHE_DIR, `${date}.json`);
  if (!refresh) {
    try {
      return JSON.parse(await fs.readFile(cacheFile, "utf8"));
    } catch {
      /* 没有缓存就正常抓 */
    }
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const json = await fetchOnce(date);
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(cacheFile, JSON.stringify(json), "utf8");
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

/** 并发抓取，保持顺序返回 */
async function fetchAll(dates, { concurrency, refresh }) {
  const records = new Array(dates.length).fill(null);
  const failures = [];
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= dates.length) return;
      const date = dates[i];
      try {
        records[i] = { date, raw: await fetchWithCache(date, { refresh }) };
      } catch (err) {
        failures.push({ date, message: err.message });
      }
      done++;
      if (!FLAGS.quiet && dates.length > 40 && done % 50 === 0) {
        log(`  ...已抓取 ${done}/${dates.length}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, dates.length)) }, worker),
  );
  return { records: records.filter(Boolean), failures };
}

// ---------------------------------------------------------------- 渲染

function renderEntryBody(raw) {
  const lines = [`> ${raw.content}`, `>`, `> ${raw.note}`];
  const media = [];
  // 配图用 fenxiang_img（词霸的分享图，为每日一句专门排版过）；picture 是被裁剪的正文配图
  if (raw.fenxiang_img) media.push(`[🖼 配图](${raw.fenxiang_img})`);
  if (raw.tts) media.push(`[🎧 朗读](${raw.tts})`);
  if (media.length) lines.push("", media.join(" · "));
  return lines.join("\n");
}

function renderMonth(ym, entries) {
  const [year, month] = ym.split("-");
  const head =
    [
      `# ${year} 年 ${month} 月`,
      "",
      `[← 返回总目录](../../README.md) ｜ 本月共 **${entries.length}** 条 ｜ 数据来源：[金山词霸 · 每日一句](${API_DOC})`,
      "",
      "---",
      "",
      "",
    ].join("\n") + "";
  return head + entries.map((e) => `## ${e.key}\n\n${e.body}\n`).join("\n");
}

function renderArchiveTable(prefix, stats) {
  const rows = [
    "| 年份 | 月份（点击进入） | 条数 |",
    "| :---: | :--- | ---: |",
  ];
  for (const y of [...stats.years].reverse()) {
    const links = y.months
      .map((m) => `[${m.month}](${prefix}${y.year}/${m.month}.md)`)
      .join(" · ");
    rows.push(`| **${y.year}** | ${links} | ${y.total} |`);
  }
  rows.push(`| **合计** | ${stats.monthCount} 个月 | **${stats.total}** |`);
  return rows.join("\n");
}

// ---------------------------------------------------------------- 归档读写

function monthFile(ym) {
  const [year, month] = ym.split("-");
  return path.join(SENTENCES_DIR, year, `${month}.md`);
}

async function readFileOrNull(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** 读一个月文件，返回 [{key:'2026/10/15', body:'...'}] */
async function readMonth(file) {
  const text = await readFileOrNull(file);
  if (text === null) return [];
  const marks = [...text.matchAll(DATE_HEADING)];
  return marks.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    return { key: m[1], body: text.slice(start, end).trim() };
  });
}

/** 扫描全部月份文件 → 统计信息 */
async function scanArchive() {
  const years = [];
  const allKeys = [];

  let yearDirs = [];
  try {
    yearDirs = (await fs.readdir(SENTENCES_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return { years: [], total: 0, monthCount: 0, allKeys: [] };
  }

  for (const year of yearDirs) {
    const dir = path.join(SENTENCES_DIR, year);
    let files = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => /^\d{2}\.md$/.test(f)).sort();
    } catch {
      continue;
    }
    const months = [];
    let yearTotal = 0;
    for (const f of files) {
      const month = f.slice(0, 2);
      const entries = await readMonth(path.join(dir, f));
      months.push({ month, count: entries.length });
      yearTotal += entries.length;
      allKeys.push(...entries.map((e) => e.key));
    }
    years.push({ year, months, total: yearTotal });
  }

  allKeys.sort();
  return {
    years,
    total: allKeys.length,
    monthCount: years.reduce((n, y) => n + y.months.length, 0),
    allKeys,
  };
}
/** 最新的那条记录 */
async function readLatest(stats) {
  if (!stats.allKeys.length) return null;
  const key = stats.allKeys[stats.allKeys.length - 1];
  const entries = await readMonth(monthFile(key.slice(0, 7).replace("/", "-")));
  return entries.find((e) => e.key === key) ?? null;
}

// ---------------------------------------------------------------- 索引重建

function replaceBlock(text, tag, content) {
  const start = `<!-- ${tag}:START -->`;
  const end = `<!-- ${tag}:END -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j < i) {
    warn(`[warn] README.md 缺少 ${tag} 标记块，已跳过该段`);
    return null;
  }
  return text.slice(0, i + start.length) + "\n" + content + "\n" + text.slice(j);
}

async function rebuildIndexes({ dryRun = false } = {}) {
  const stats = await scanArchive();
  if (!stats.total) {
    warn("[warn] 归档为空，跳过索引重建");
    return { changed: [] };
  }

  const changed = [];
  const first = stats.allKeys[0].slice(0, 7);
  const last = stats.allKeys[stats.allKeys.length - 1].slice(0, 7);

  // ---- README.md 的三个标记块
  const original = await readFileOrNull(ROOT_README);
  if (original === null) {
    warn("[warn] 找不到 README.md，跳过根索引");
  } else {
    let text = original;
    const latest = await readLatest(stats);
    // latest.key 形如 2026/10/16（斜杠分隔），不能按 "-" 切
    const [latestYear, latestMon] = latest.key.slice(0, 7).split("/");
    const latestCount =
      stats.years.find((y) => y.year === latestYear)?.months
        .find((m) => m.month === latestMon)?.count ?? 0;

    const blocks = {
      STATS: `> **累计 ${stats.total} 条** ｜ 覆盖 **${stats.monthCount} 个月**（${first} – ${last}） ｜ 每月 1 号自动补齐上月`,
      LATEST:
        `### ${latest.key}\n\n` +
        `${latest.body}\n\n` +
        `[查看 ${latestYear} 年 ${latestMon} 月全部 ${latestCount} 条 →](sentences/${latestYear}/${latestMon}.md)`,
      ARCHIVE: renderArchiveTable("sentences/", stats),
    };

    for (const [tag, content] of Object.entries(blocks)) {
      const next = replaceBlock(text, tag, content);
      if (next !== null) text = next;
    }

    if (text !== original) {
      if (!dryRun) await fs.writeFile(ROOT_README, text, "utf8");
      changed.push("README.md");
    }
  }

  // ---- sentences/README.md 整份生成
  const archiveDoc = `<!-- 本文件由 daily-sentence.mjs 自动生成，请勿手动修改 -->

# 📚 归档总览

共 **${stats.total}** 条，覆盖 **${stats.monthCount}** 个月（${first} – ${last}）。

[← 返回项目首页](../README.md) ｜ 数据来源：[金山词霸 · 每日一句](${API_DOC})

${renderArchiveTable("", stats)}
`;
  const prevArchiveDoc = await readFileOrNull(ARCHIVE_README);
  if (prevArchiveDoc !== archiveDoc) {
    if (!dryRun) {
      await fs.mkdir(SENTENCES_DIR, { recursive: true });
      await fs.writeFile(ARCHIVE_README, archiveDoc, "utf8");
    }
    changed.push("sentences/README.md");
  }

  return { changed, stats };
}

// ---------------------------------------------------------------- 写入

/**
 * 把抓到的记录合并进月份文件。
 *
 * 抓取阶段是并发的，但这里严格按「月份分组 + 顺序合并 + 每月只写一次」落盘，
 * 避免并发读-改-写互相覆盖，也保证同样的输入永远得到同样的输出。
 */
async function applyRecords(records, { dryRun = false } = {}) {
  const stats = { added: 0, updated: 0, same: 0, files: [], unchangedFiles: 0 };

  const byMonth = new Map();
  for (const rec of records) {
    const ym = ymOf(rec.date);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(rec);
  }

  for (const ym of [...byMonth.keys()].sort()) {
    const file = monthFile(ym);
    const existingEntries = await readMonth(file);
    const map = new Map(existingEntries.map((e) => [e.key, e.body]));

    for (const rec of byMonth.get(ym).sort((a, b) => a.date.localeCompare(b.date))) {
      const key = rec.date.replace(/-/g, "/");
      const body = renderEntryBody(rec.raw);
      const old = map.get(key);
      if (old === undefined) {
        stats.added++;
        map.set(key, body);
      } else if (old.trim() === body.trim()) {
        stats.same++;
      } else {
        stats.updated++;
        map.set(key, body);
      }
    }

    const merged = [...map.entries()]
      .map(([key, body]) => ({ key, body }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const text = renderMonth(ym, merged);
    const current = await readFileOrNull(file);

    if (current === text) {
      stats.unchangedFiles++;
      continue;
    }
    if (!dryRun) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text, "utf8");
    }
    stats.files.push(ym);
  }

  return stats;
}

// ---------------------------------------------------------------- 体检

async function checkArchive() {
  const stats = await scanArchive();
  if (!stats.total) {
    warn("归档为空");
    return 1;
  }
  const first = stats.allKeys[0].replace(/\//g, "-");
  const last = stats.allKeys[stats.allKeys.length - 1].replace(/\//g, "-");
  const expected = listDates(first, last);
  const present = new Set(stats.allKeys.map((k) => k.replace(/\//g, "-")));
  const missing = expected.filter((d) => !present.has(d));

  console.log(`归档区间：${first} → ${last}`);
  console.log(`应有 ${expected.length} 条，实际 ${stats.total} 条，缺失 ${missing.length} 条`);
  console.log(`起始日期应为 ${ARCHIVE_START}：${first === ARCHIVE_START ? "✓" : `✗（实际 ${first}）`}`);

  if (missing.length) {
    const ranges = [];
    let start = missing[0];
    let prev = missing[0];
    for (const d of missing.slice(1)) {
      if (d !== addDays(prev, 1)) {
        ranges.push(start === prev ? start : `${start} ~ ${prev}`);
        start = d;
      }
      prev = d;
    }
    ranges.push(start === prev ? start : `${start} ~ ${prev}`);
    console.log(`缺失区间（最多显示 20 段）：`);
    ranges.slice(0, 20).forEach((r) => console.log(`  - ${r}`));
    if (ranges.length > 20) console.log(`  ...另有 ${ranges.length - 20} 段`);
    return 1;
  }
  console.log("连续性检查通过 ✓");
  return 0;
}

// ---------------------------------------------------------------- 主流程

const FLAGS = { quiet: false };

function usage() {
  console.log(`每日一句归档脚本

  node daily-sentence.mjs [选项]

选项：
  --date <YYYY-MM-DD>    只抓指定的一天
  --month <YYYY-MM>      抓指定的整月
  --from <YYYY-MM-DD>    区间起始（需与 --to 同时使用）
  --to   <YYYY-MM-DD>    区间结束
  --rebuild-index        只重建 README 索引，不抓取
  --check                只做归档连续性体检
  --dry-run              演练，不写入任何文件
  --refresh              忽略本地缓存，强制重新请求
  --concurrency <n>      并发数，默认 6
  --quiet                安静模式
  --help                 显示帮助
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      date: { type: "string" },
      month: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "rebuild-index": { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      refresh: { type: "boolean", default: false },
      concurrency: { type: "string", default: "6" },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  FLAGS.quiet = values.quiet;
  const dryRun = values["dry-run"];
  const concurrency = Math.max(1, Number(values.concurrency) || 6);
  const today = beijingToday();

  if (values.help) return usage();

  if (typeof fetch !== "function") {
    throw new Error("当前 Node.js 不支持全局 fetch，请使用 Node.js 18 或更高版本");
  }

  if (values.check) {
    process.exitCode = await checkArchive();
    return;
  }

  if (values["rebuild-index"]) {
    const { changed, stats } = await rebuildIndexes({ dryRun });
    report(
      `索引重建完成：${stats.total} 条 / ${stats.monthCount} 个月` +
        (changed.length ? `，更新 ${changed.join(", ")}` : "，无需更新"),
    );
    return;
  }

  // ---- 计算要抓取的日期区间
  let from;
  let to;
  let mode;

  // 区间模式需要先读归档（默认从「最后一条的次日」开始）；单日/整月模式不必
  const needArchive = !values.date && !values.month;
  const archive = needArchive ? await scanArchive() : null;
  const newest = archive?.allKeys.length
    ? archive.allKeys[archive.allKeys.length - 1].replace(/\//g, "-")
    : null;
  const defaultFrom = newest ? addDays(newest, 1) : ARCHIVE_START;
  const defaultTo = lastDayOfPreviousMonth(today);

  if (values.date) {
    from = to = assertDate(values.date, "--date");
    mode = "单日";
  } else if (values.month) {
    if (!/^\d{4}-\d{2}$/.test(values.month)) throw new Error("--month 格式应为 YYYY-MM");
    const r = monthRange(values.month);
    from = r.from;
    to = r.to;
    mode = "整月";
  } else if (values.from || values.to) {
    from = values.from ? assertDate(values.from, "--from") : defaultFrom;
    to = values.to ? assertDate(values.to, "--to") : defaultTo;
    mode = "区间";
  } else {
    // 默认（CI）：从归档最后一条的下一天，补到上个月最后一天 —— 漏跑也能自愈
    from = defaultFrom;
    to = defaultTo;
    mode = "自动补齐";
  }

  // 绝不请求未来日期（接口会返回「参数不合法」）
  if (to > today) to = today;

  if (from > to) {
    report(`[${mode}] 没有需要抓取的日期（${from} > ${to}），归档已是最新 ✓`);
    const { changed, stats } = await rebuildIndexes({ dryRun });
    if (changed.length) report(`索引已更新：${changed.join(", ")}（共 ${stats.total} 条）`);
    return;
  }

  const dates = listDates(from, to);
  log(`[${mode}] 待抓取 ${dates.length} 天：${from} → ${to}`);

  const { records, failures } = await fetchAll(dates, {
    concurrency,
    refresh: values.refresh,
  });

  const writeStats = await applyRecords(records, { dryRun });
  report(
    `写入完成：新增 ${writeStats.added} 条，更新 ${writeStats.updated} 条，` +
      `未变 ${writeStats.same} 条，落盘 ${writeStats.files.length} 个月文件`,
  );

  const { changed } = await rebuildIndexes({ dryRun });
  if (changed.length) report(`索引已更新：${changed.join(", ")}`);

  if (failures.length) {
    warn(`\n[error] 有 ${failures.length} 天抓取失败：`);
    failures.slice(0, 20).forEach((f) => warn(`  - ${f.date}: ${f.message}`));
    if (failures.length > 20) warn(`  ...另有 ${failures.length - 20} 天`);
    process.exitCode = 1;
  } else {
    report("全部成功 ✓");
  }
}

main().catch((err) => {
  warn(`[error] ${err.message}`);
  process.exitCode = 1;
});
