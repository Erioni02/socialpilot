import { providerFetch, ProviderError } from "@socialpilot/core";

// ───────────── Google OAuth (used for GA4) ─────────────

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
}

export function googleAuthUrl(creds: GoogleCreds, redirectUri: string, state: string, scopes: string[], codeChallenge: string) {
  const p = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function googleToken(form: Record<string, string>) {
  const r = await providerFetch<any>("google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  return {
    accessToken: r.access_token as string,
    refreshToken: r.refresh_token as string | undefined,
    expiresAt: new Date(Date.now() + (r.expires_in ?? 3600) * 1000),
    scopes: String(r.scope ?? "").split(" ").filter(Boolean),
    idToken: r.id_token as string | undefined,
  };
}

export function googleExchangeCode(creds: GoogleCreds, code: string, redirectUri: string, codeVerifier: string) {
  return googleToken({ client_id: creds.clientId, client_secret: creds.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: codeVerifier });
}
export function googleRefresh(creds: GoogleCreds, refreshToken: string) {
  return googleToken({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken });
}
export async function googleRevoke(token: string) {
  await providerFetch("google", `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
}
export async function googleUserEmail(accessToken: string): Promise<string | undefined> {
  const r = await providerFetch<any>("google", "https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  return r.email;
}

// ───────────── GA4 ─────────────

export async function ga4ListProperties(accessToken: string) {
  const r = await providerFetch<any>("ga4", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const out: { propertyId: string; displayName: string; account: string }[] = [];
  for (const a of r.accountSummaries ?? []) {
    for (const p of a.propertySummaries ?? []) out.push({ propertyId: String(p.property).replace("properties/", ""), displayName: p.displayName, account: a.displayName });
  }
  return out;
}

export async function ga4RunReport(accessToken: string, propertyId: string, body: Record<string, unknown>) {
  return providerFetch<any>("ga4", `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rows(report: any): { dims: string[]; mets: number[] }[] {
  return (report.rows ?? []).map((r: any) => ({
    dims: (r.dimensionValues ?? []).map((d: any) => d.value),
    mets: (r.metricValues ?? []).map((m: any) => Number(m.value)),
  }));
}

export interface WebAnalyticsSummary {
  source: "ga4" | "plausible";
  range: { start: string; end: string };
  daily: { date: string; sessions: number; users: number; pageviews: number; conversions: number | null }[];
  totals: { sessions: number; users: number; pageviews: number; conversions: number | null; bounceRate: number | null };
  referrers: { source: string; sessions: number }[];
  campaigns: { campaign: string; source: string; sessions: number; conversions: number | null }[];
  topPages: { path: string; pageviews: number }[];
  definitions: Record<string, string>;
}

export async function ga4Summary(accessToken: string, propertyId: string, days = 28): Promise<WebAnalyticsSummary> {
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: "today" }];
  const [daily, refs, camps, pages] = await Promise.all([
    ga4RunReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "keyEvents" }, { name: "bounceRate" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    ga4RunReport(accessToken, propertyId, { dateRanges, dimensions: [{ name: "sessionSource" }], metrics: [{ name: "sessions" }], limit: 15, orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }),
    ga4RunReport(accessToken, propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionCampaignName" }, { name: "sessionSource" }],
      metrics: [{ name: "sessions" }, { name: "keyEvents" }],
      limit: 25,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }),
    ga4RunReport(accessToken, propertyId, { dateRanges, dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }], limit: 10, orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }] }),
  ]);
  const d = rows(daily).map((r) => ({
    date: `${r.dims[0].slice(0, 4)}-${r.dims[0].slice(4, 6)}-${r.dims[0].slice(6, 8)}`,
    sessions: r.mets[0],
    users: r.mets[1],
    pageviews: r.mets[2],
    conversions: r.mets[3],
    bounce: r.mets[4],
  }));
  const sum = (k: "sessions" | "users" | "pageviews" | "conversions") => d.reduce((s, x) => s + (x[k] ?? 0), 0);
  const sessions = sum("sessions");
  return {
    source: "ga4",
    range: { start: d[0]?.date ?? "", end: d[d.length - 1]?.date ?? "" },
    daily: d.map(({ bounce: _b, ...rest }) => rest),
    totals: {
      sessions,
      users: sum("users"),
      pageviews: sum("pageviews"),
      conversions: sum("conversions"),
      bounceRate: sessions ? d.reduce((s, x) => s + x.bounce * x.sessions, 0) / sessions : null,
    },
    referrers: rows(refs).map((r) => ({ source: r.dims[0], sessions: r.mets[0] })),
    campaigns: rows(camps)
      .filter((r) => r.dims[0] && r.dims[0] !== "(not set)" && r.dims[0] !== "(direct)" && r.dims[0] !== "(organic)" && r.dims[0] !== "(referral)")
      .map((r) => ({ campaign: r.dims[0], source: r.dims[1], sessions: r.mets[0], conversions: r.mets[1] })),
    topPages: rows(pages).map((r) => ({ path: r.dims[0], pageviews: r.mets[0] })),
    definitions: {
      sessions: "GA4 sessions",
      users: "GA4 totalUsers",
      pageviews: "GA4 screenPageViews",
      conversions: "GA4 keyEvents (configured key events)",
      bounceRate: "GA4 bounceRate (share of sessions that were not engaged)",
    },
  };
}

// ───────────── Plausible ─────────────

export async function plausibleQuery(baseUrl: string, apiKey: string, body: Record<string, unknown>) {
  return providerFetch<any>("plausible", `${baseUrl.replace(/\/$/, "")}/api/v2/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function plausibleSummary(baseUrl: string, apiKey: string, siteId: string, days = 28): Promise<WebAnalyticsSummary> {
  const date_range = `${days}d`;
  const [daily, totals, refs, camps, pages] = await Promise.all([
    plausibleQuery(baseUrl, apiKey, { site_id: siteId, metrics: ["visitors", "visits", "pageviews"], date_range, dimensions: ["time:day"] }),
    plausibleQuery(baseUrl, apiKey, { site_id: siteId, metrics: ["visitors", "visits", "pageviews", "bounce_rate"], date_range }),
    plausibleQuery(baseUrl, apiKey, { site_id: siteId, metrics: ["visits"], date_range, dimensions: ["visit:source"], order_by: [["visits", "desc"]], pagination: { limit: 15 } }),
    plausibleQuery(baseUrl, apiKey, { site_id: siteId, metrics: ["visits"], date_range, dimensions: ["visit:utm_campaign", "visit:utm_source"], order_by: [["visits", "desc"]], pagination: { limit: 25 } }),
    plausibleQuery(baseUrl, apiKey, { site_id: siteId, metrics: ["pageviews"], date_range, dimensions: ["event:page"], order_by: [["pageviews", "desc"]], pagination: { limit: 10 } }),
  ]);
  const d = (daily.results ?? []).map((r: any) => ({ date: String(r.dimensions[0]).slice(0, 10), users: r.metrics[0], sessions: r.metrics[1], pageviews: r.metrics[2], conversions: null }));
  const t = totals.results?.[0]?.metrics ?? [0, 0, 0, null];
  if (!totals.results) throw new ProviderError("plausible", "Unexpected response from Plausible");
  return {
    source: "plausible",
    range: { start: d[0]?.date ?? "", end: d[d.length - 1]?.date ?? "" },
    daily: d,
    totals: { users: t[0], sessions: t[1], pageviews: t[2], conversions: null, bounceRate: t[3] != null ? t[3] / 100 : null },
    referrers: (refs.results ?? []).map((r: any) => ({ source: r.dimensions[0], sessions: r.metrics[0] })),
    campaigns: (camps.results ?? []).filter((r: any) => r.dimensions[0] && r.dimensions[0] !== "(none)").map((r: any) => ({ campaign: r.dimensions[0], source: r.dimensions[1], sessions: r.metrics[0], conversions: null })),
    topPages: (pages.results ?? []).map((r: any) => ({ path: r.dimensions[0], pageviews: r.metrics[0] })),
    definitions: { sessions: "Plausible visits", users: "Plausible unique visitors", pageviews: "Plausible pageviews", conversions: "Goals are not queried (configure goals in Plausible)", bounceRate: "Plausible bounce rate" },
  };
}
