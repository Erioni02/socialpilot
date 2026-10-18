export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Adds UTM campaign tracking parameters so social traffic can be attributed in web analytics. */
export function withUtm(link: string, params: { source: string; medium?: string; campaign?: string; content?: string }): string {
  try {
    const u = new URL(link);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", params.source);
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", params.medium ?? "social");
    if (params.campaign && !u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", slugify(params.campaign));
    if (params.content && !u.searchParams.has("utm_content")) u.searchParams.set("utm_content", params.content);
    return u.toString();
  } catch {
    return link;
  }
}
