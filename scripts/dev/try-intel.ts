import { analyzeSocialUrl } from "../../packages/integrations/src/index";
const urls = process.argv.slice(2);
for (const u of urls) {
  const { parsed, outcome } = await analyzeSocialUrl(u, { bypassCache: true });
  const r = outcome.result;
  console.log(`\n${u}\n  parsed: ${parsed ? `${parsed.platform}/${parsed.kind}/${parsed.externalId}` : "-"}  status: ${outcome.status}${outcome.message ? ` — ${outcome.message.slice(0, 140)}` : ""}`);
  if (r) console.log(`  metrics: ${JSON.stringify(r.metrics)}  author: ${JSON.stringify(r.author?.metrics ?? {})}  confidence: ${r.confidence}  unavailable: ${r.unavailable.map((x) => x.metric).join(", ")}`);
  if (outcome.paidOptions) console.log(`  paid option: ${outcome.paidOptions.map((p) => `${p.label} ~$${p.estimatedCostUsd}`).join(", ")}`);
}
