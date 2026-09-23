#!/usr/bin/env node
// Hugging Face Daily Papers에서 최근 N일치 논문을 모아 data/feed/<날짜>.json 으로 저장한다.
// 클라우드 루틴은 외부 망이 막혀 있으므로, 이 스크립트가 GitHub Actions에서 돌아 초록까지 저장소에 넣어 둔다.

import { writeFileSync, mkdirSync } from "node:fs";

const WINDOW_DAYS = Number(process.env.WINDOW_DAYS ?? 14);
const KEEP = Number(process.env.KEEP ?? 40);

const kstToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

function datesBack(days) {
  const out = [];
  const base = new Date(`${kstToday()}T00:00:00+09:00`);
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() - i * 86400000);
    out.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d));
  }
  return out;
}

async function fetchDay(date) {
  const url = `https://huggingface.co/api/daily_papers?date=${date}&limit=100`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "noon-ai-papers/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 2) {
        console.warn(`  ${date}: 실패 (${err.message})`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return [];
}

const seen = new Map();

for (const date of datesBack(WINDOW_DAYS)) {
  const rows = await fetchDay(date);
  console.log(`  ${date}: ${rows.length}편`);
  for (const row of rows) {
    const p = row?.paper;
    if (!p?.id || !p?.summary) continue;
    const prev = seen.get(p.id);
    if (prev && prev.upvotes >= (p.upvotes ?? 0)) continue;
    seen.set(p.id, {
      arxiv: p.id,
      url: `https://arxiv.org/abs/${p.id}`,
      title: (p.title || "").replace(/\s+/g, " ").trim(),
      abstract: (p.summary || "").replace(/\s+/g, " ").trim(),
      upvotes: p.upvotes ?? 0,
      authors: (p.authors || []).slice(0, 3).map((a) => a.name).filter(Boolean),
      authorCount: (p.authors || []).length,
      organization: p.organization ?? null,
      publishedAt: p.publishedAt ?? null,
      featuredOn: date,
    });
  }
  await new Promise((r) => setTimeout(r, 250));
}

const papers = [...seen.values()].sort((a, b) => b.upvotes - a.upvotes).slice(0, KEEP);
const dates = datesBack(WINDOW_DAYS);
const feed = {
  generatedAt: new Date().toISOString(),
  source: "Hugging Face Daily Papers API",
  window: { from: dates[dates.length - 1], to: dates[0], days: WINDOW_DAYS },
  note: "추천 수(upvotes) 내림차순. 초록은 원문 그대로이므로 요약의 근거로 쓸 것.",
  count: papers.length,
  papers,
};

mkdirSync("history", { recursive: true });
const body = JSON.stringify(feed, null, 2);
writeFileSync(`history/${kstToday()}.json`, body);
writeFileSync("latest.json", body);
console.log(`\n${papers.length}편 저장 · 최고 추천 ${papers[0]?.upvotes ?? 0} · ${papers[0]?.title ?? "-"}`);
