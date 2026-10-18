import * as React from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SectionTitle } from "@/components/common";
import { cn } from "@/lib/utils";
import { LinesEditor, ProductsEditor, TagInput, type Product } from "./fields";

export type BrandValue = { colors: string[]; fonts: string[]; voice: string; tone: string[]; guidelines: string; doNotSay: string[]; hashtags: string[] };
export type ProfileValue = {
  name: string;
  websiteUrl: string;
  logoUrl: string;
  description: string;
  targetAudience: string;
  industry: string;
  products: Product[];
  objectives: string[];
  keywords: string[];
  competitors: string[];
  brand: BrandValue;
  timezone: string;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const emptyBrand = (): BrandValue => ({ colors: [], fonts: [], voice: "", tone: [], guidelines: "", doNotSay: [], hashtags: [] });

export function brandFrom(raw: any): BrandValue {
  const b = raw ?? {};
  return { colors: arr(b.colors), fonts: arr(b.fonts), voice: b.voice ?? "", tone: arr(b.tone), guidelines: b.guidelines ?? "", doNotSay: arr(b.doNotSay), hashtags: arr(b.hashtags) };
}

export function profileFromProject(p: any): ProfileValue {
  return {
    name: p?.name ?? "",
    websiteUrl: p?.websiteUrl ?? "",
    logoUrl: p?.logoUrl ?? "",
    description: p?.description ?? "",
    targetAudience: p?.targetAudience ?? "",
    industry: p?.industry ?? "",
    products: Array.isArray(p?.products) ? p.products.map((x: any) => ({ name: x?.name ?? "", description: x?.description ?? "" })) : [],
    objectives: arr(p?.objectives),
    keywords: arr(p?.keywords),
    competitors: arr(p?.competitors),
    brand: p?.brand ? brandFrom(p.brand) : emptyBrand(),
    timezone: p?.timezone || "UTC",
  };
}

/** Merges an analysis proposal over the current project. Proposal values win where present; existing user data stays otherwise. */
export function profileFromProposal(project: any, proposal: any): ProfileValue {
  const base = profileFromProject(project);
  if (!proposal) return base;
  const pick = (a: string, b: string | undefined | null) => (b && b.trim() ? b : a);
  const pickArr = <T,>(a: T[], b: T[] | undefined) => (b && b.length ? b : a);
  const pb = proposal.brand ?? {};
  return {
    ...base,
    name: base.name || proposal.name || "",
    logoUrl: base.logoUrl || proposal.logoUrl || "",
    description: pick(base.description, proposal.description),
    targetAudience: pick(base.targetAudience, proposal.targetAudience),
    industry: pick(base.industry, proposal.industry),
    products: pickArr(base.products, Array.isArray(proposal.products) ? proposal.products.map((x: any) => ({ name: x?.name ?? "", description: x?.description ?? "" })) : undefined),
    objectives: pickArr(base.objectives, arr(proposal.objectives)),
    keywords: pickArr(base.keywords, arr(proposal.keywords)),
    competitors: pickArr(base.competitors, arr(proposal.competitors)),
    brand: {
      colors: pickArr(base.brand.colors, arr(proposal.colors)).slice(0, 12),
      fonts: pickArr(base.brand.fonts, arr(proposal.fonts)).slice(0, 6),
      voice: pick(base.brand.voice, pb.voice),
      tone: pickArr(base.brand.tone, arr(pb.tone)),
      guidelines: pick(base.brand.guidelines, pb.guidelines),
      doNotSay: pickArr(base.brand.doNotSay, arr(pb.doNotSay)),
      hashtags: pickArr(base.brand.hashtags, arr(pb.hashtags)),
    },
  };
}

/** Converts the form value to the API payload (projectUpdateSchema). */
export function profilePayload(v: ProfileValue) {
  return {
    name: v.name.trim(),
    websiteUrl: v.websiteUrl.trim() ? v.websiteUrl.trim() : null,
    logoUrl: v.logoUrl.trim() ? v.logoUrl.trim() : null,
    description: v.description,
    targetAudience: v.targetAudience,
    industry: v.industry,
    products: v.products.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), description: x.description })),
    objectives: v.objectives.map((s) => s.trim()).filter(Boolean),
    keywords: v.keywords,
    competitors: v.competitors.map((s) => s.trim()).filter(Boolean),
    brand: v.brand,
    timezone: v.timezone,
  };
}

let tzCache: string[] | null = null;
function timezones(): string[] {
  if (tzCache) return tzCache;
  try {
    tzCache = (Intl as any).supportedValuesOf("timeZone") as string[];
    if (!tzCache.includes("UTC")) tzCache = ["UTC", ...tzCache];
  } catch {
    tzCache = ["UTC"];
  }
  return tzCache;
}

function ColorSwatches({ colors }: { colors: string[] }) {
  if (!colors.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {colors.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted font-mono">
          <span className="h-4 w-4 rounded border border-line" style={{ background: c }} />
          {c}
        </span>
      ))}
    </div>
  );
}

/** Shared business profile & brand editor (wizard step 4 and Project settings). Purely controlled. */
export function ProfileEditor({ value, onChange, logoCandidates = [], showIdentity = true }: { value: ProfileValue; onChange: (v: ProfileValue) => void; logoCandidates?: string[]; showIdentity?: boolean }) {
  const set = <K extends keyof ProfileValue>(k: K, v: ProfileValue[K]) => onChange({ ...value, [k]: v });
  const setBrand = <K extends keyof BrandValue>(k: K, v: BrandValue[K]) => onChange({ ...value, brand: { ...value.brand, [k]: v } });
  const tzs = React.useMemo(timezones, []);
  const logos = [...new Set([...(value.logoUrl ? [value.logoUrl] : []), ...logoCandidates])];
  return (
    <div className="space-y-8">
      {showIdentity && (
        <section>
          <SectionTitle>Identity</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name">
              <Input value={value.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Website URL" hint="Optional">
              <Input value={value.websiteUrl} placeholder="https://example.com" onChange={(e) => set("websiteUrl", e.target.value)} />
            </Field>
            <Field label="Logo" className="sm:col-span-2" hint={logoCandidates.length ? "Candidates found on the website — pick one or paste a URL." : "Paste an image URL."}>
              {logos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-1">
                  {logos.map((l) => (
                    <button
                      type="button"
                      key={l}
                      onClick={() => set("logoUrl", value.logoUrl === l ? "" : l)}
                      className={cn("h-14 w-14 rounded-lg border bg-canvas p-1.5 flex items-center justify-center overflow-hidden transition-colors", value.logoUrl === l ? "border-ink ring-2 ring-ink/10" : "border-line hover:border-line-strong")}
                      title={l}
                    >
                      <img src={l} alt="" className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
                    </button>
                  ))}
                </div>
              )}
              <Input value={value.logoUrl} placeholder="https://…/logo.png" onChange={(e) => set("logoUrl", e.target.value)} />
            </Field>
            <Field label="Timezone" hint="Used for scheduling and publish hours.">
              <Select value={value.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {!tzs.includes(value.timezone) && <option value={value.timezone}>{value.timezone}</option>}
                {tzs.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Industry">
              <Input value={value.industry} placeholder="e.g. Developer tools" onChange={(e) => set("industry", e.target.value)} />
            </Field>
          </div>
        </section>
      )}

      <section>
        <SectionTitle>Business</SectionTitle>
        <div className="grid gap-4">
          {!showIdentity && (
            <Field label="Industry">
              <Input value={value.industry} onChange={(e) => set("industry", e.target.value)} />
            </Field>
          )}
          <Field label="Description" hint="What the business does, in plain words. Agents use this as ground truth.">
            <Textarea value={value.description} onChange={(e) => set("description", e.target.value)} className="min-h-[96px]" />
          </Field>
          <Field label="Target audience">
            <Textarea value={value.targetAudience} onChange={(e) => set("targetAudience", e.target.value)} className="min-h-[72px]" />
          </Field>
          <Field label="Products & services">
            <ProductsEditor value={value.products} onChange={(v) => set("products", v)} />
          </Field>
          <Field label="Marketing objectives" hint="Suggestions are hypotheses — keep only the ones you actually pursue.">
            <LinesEditor value={value.objectives} onChange={(v) => set("objectives", v)} placeholder="e.g. Grow weekly sign-ups from social" addLabel="Add objective" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Keywords" hint="Used to match trends and opportunities.">
              <TagInput value={value.keywords} onChange={(v) => set("keywords", v)} max={50} />
            </Field>
            <Field label="Competitors">
              <TagInput value={value.competitors} onChange={(v) => set("competitors", v)} max={20} placeholder="Name or URL" />
            </Field>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Brand</SectionTitle>
        <div className="grid gap-4">
          <Field label="Brand voice">
            <Textarea value={value.brand.voice} onChange={(e) => setBrand("voice", e.target.value)} placeholder="e.g. Direct, witty, never condescending. Speaks like a senior engineer." className="min-h-[64px]" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tone">
              <TagInput value={value.brand.tone} onChange={(v) => setBrand("tone", v)} max={12} placeholder="confident, playful…" />
            </Field>
            <Field label="Hashtags">
              <TagInput value={value.brand.hashtags} onChange={(v) => setBrand("hashtags", v)} max={40} transform={(s) => (s.startsWith("#") ? s : `#${s}`)} placeholder="#buildinpublic" />
            </Field>
            <Field label="Colors">
              <TagInput value={value.brand.colors} onChange={(v) => setBrand("colors", v)} max={12} placeholder="#111111" />
              <ColorSwatches colors={value.brand.colors} />
            </Field>
            <Field label="Fonts">
              <TagInput value={value.brand.fonts} onChange={(v) => setBrand("fonts", v)} max={6} placeholder="Inter" />
            </Field>
          </div>
          <Field label="Guidelines">
            <Textarea value={value.brand.guidelines} onChange={(e) => setBrand("guidelines", e.target.value)} placeholder="Rules every post should follow." className="min-h-[72px]" />
          </Field>
          <Field label="Never say" hint="Words, claims or topics agents must avoid.">
            <TagInput value={value.brand.doNotSay} onChange={(v) => setBrand("doNotSay", v)} max={50} />
          </Field>
        </div>
      </section>
    </div>
  );
}
