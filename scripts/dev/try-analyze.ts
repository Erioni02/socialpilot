import { analyzeWebsite } from "../../packages/integrations/src/index";
const r = await analyzeWebsite(process.argv[2] ?? "https://vibejudge.app", { maxPages: 5, runPagespeed: false, onProgress: (m) => console.log("·", m) });
console.log(JSON.stringify({ finalUrl: r.finalUrl, pages: r.pages.map((p) => [p.url, p.status, p.timingMs, p.title, p.wordCount]), scores: r.scores, issues: r.issues.map((i) => `${i.severity} ${i.title}`), hints: r.profileHints, broken: r.brokenLinks }, null, 1));
