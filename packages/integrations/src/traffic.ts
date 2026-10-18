import { ApifyClient } from "apify-client";
import { ProviderError } from "@socialpilot/core";

/**
 * Third-party website traffic estimates via the Apify actor "santhej/website-traffic-intel".
 * These are SEO-based estimates of monthly organic search traffic, not measured visits.
 * Pricing is pay-per-event (~$0.16 per domain overview at standard rates), so it only runs on explicit request and
 * every run carries a hard cap (`maxBudgetUsd` in the actor input + `maxTotalChargeUsd` on the Apify run).
 */
export const TRAFFIC_ACTOR = "santhej/website-traffic-intel";
export const TRAFFIC_EST_COST_PER_DOMAIN = 0.161;

export interface TrafficOverview {
  domain: string;
  estimatedMonthlyOrganicTraffic: number | null;
  organicKeywordCount: number | null;
  paidTraffic: number | null;
  paidKeywordCount: number | null;
  positionDistribution: Record<string, number> | null;
  topKeywords: { keyword: string; position?: number; url?: string; searchVolume?: number; cpc?: number; trafficEstimate?: number }[];
  topCompetitors: { domain: string; commonKeywords?: number; avgPosition?: number; estimatedMonthlyTraffic?: number }[];
  dataStatus: string;
  scrapedAt?: string;
}

export function normalizeDomain(raw: string): string {
  const s = raw.trim().toLowerCase();
  const host = (() => {
    try {
      return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname;
    } catch {
      return "";
    }
  })().replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw new ProviderError("apify", `"${raw}" is not a valid domain`);
  return host;
}

export async function runTrafficOverview(token: string, domainRaw: string, maxBudgetUsd: number, opts: { locationCode?: string; maxKeywords?: number; maxCompetitors?: number } = {}) {
  const domain = normalizeDomain(domainRaw);
  const client = new ApifyClient({ token });
  const run = await client.actor(TRAFFIC_ACTOR).call(
    {
      mode: "overview",
      domains: [domain],
      locationCode: opts.locationCode ?? "2840",
      maxKeywords: opts.maxKeywords ?? 50,
      maxCompetitors: opts.maxCompetitors ?? 10,
      maxBudgetUsd,
    },
    { maxTotalChargeUsd: maxBudgetUsd, timeout: 300, waitSecs: 320 },
  );
  if (run.status !== "SUCCEEDED") throw new ProviderError("apify", `Actor run ${run.status.toLowerCase()} (run ${run.id})`);
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 100 });
  const err = items.find((i: any) => i.record_type === "input_error");
  if (err) throw new ProviderError("apify", `Input error: ${(err as any).message ?? JSON.stringify(err).slice(0, 200)}`);
  const o: any = items.find((i: any) => i.record_type === "domain_overview");
  const summary: any = items.find((i: any) => i.record_type === "run_summary");
  const overview: TrafficOverview | null = o
    ? {
        domain: o.domain,
        estimatedMonthlyOrganicTraffic: o.estimated_monthly_organic_traffic ?? null,
        organicKeywordCount: o.organic_keyword_count ?? null,
        paidTraffic: o.estimated_monthly_paid_traffic ?? o.paid_traffic ?? null,
        paidKeywordCount: o.paid_keyword_count ?? null,
        positionDistribution: o.position_distribution ?? null,
        topKeywords: (o.top_keywords ?? []).map((k: any) => ({ keyword: k.keyword, position: k.position, url: k.url, searchVolume: k.search_volume, cpc: k.cpc, trafficEstimate: k.traffic_estimate })),
        topCompetitors: (o.top_competitors ?? []).map((c: any) => ({ domain: c.domain, commonKeywords: c.common_keywords, avgPosition: c.avg_position, estimatedMonthlyTraffic: c.estimated_monthly_traffic })),
        dataStatus: o.data_status ?? "ok",
        scrapedAt: o.scraped_at,
      }
    : null;
  return {
    domain,
    overview,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    costUsd: typeof (run as any).usageTotalUsd === "number" ? (run as any).usageTotalUsd : (summary?.charge ?? summary?.total_charge_usd ?? null),
    summary: summary ?? null,
  };
}
