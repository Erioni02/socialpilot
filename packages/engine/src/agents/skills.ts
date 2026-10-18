import type { AgentType } from "@socialpilot/shared";

/**
 * Skill library: expert playbooks the agents load on demand (progressive disclosure keeps prompts lean).
 * MARKETING_CORE is always in the system prompt; each agent type also gets its most relevant skills preloaded,
 * and any agent can pull another with the `load_skill` tool.
 */

export const MARKETING_CORE = `Marketing operating principles (always apply):
- Start from the customer, not the product: who exactly, what painful/urgent problem, what they already tried, what "better" looks like in their words. Use the project profile's audience and language.
- One message, one audience, one action per asset. If you can't say the point in one sentence, don't produce the asset yet.
- Specific beats clever: concrete numbers, outcomes, timeframes, names of real features. Cut adjectives that any competitor could use.
- Lead with the hook. The first line / first 1.5 seconds / the headline decides whether anything else is read.
- Proof before promise: real results, demos, screenshots, process, customer words. Never invent testimonials, stats or logos.
- Every asset has a job (awareness, engagement, click, signup, purchase) and a measurable success metric; say which.
- Match the channel's native format and culture; repurpose, don't copy-paste across platforms.
- Ship many small bets, measure, double down on winners; label ideas as hypotheses until data confirms them.
- Ride timely trends only when the brand has a genuine angle; never exploit tragedies or sensitive events.
- Stay on brand: voice, colors, blocked topics. Compliance: no false claims, disclose ads/partnerships, respect platform rules.`;

export interface Skill {
  name: string;
  title: string;
  description: string;
  preloadFor: AgentType[];
  body: string;
}

export const SKILLS: Skill[] = [
  {
    name: "positioning-messaging",
    title: "Positioning & messaging",
    description: "Find the sharpest angle: category, competitive alternatives, unique value, messaging hierarchy.",
    preloadFor: ["marketing_strategy", "general"],
    body: `Positioning (April Dunford method):
1. Competitive alternatives — what customers would do without us (incl. spreadsheets, agencies, doing nothing).
2. Unique attributes — capabilities we have that alternatives lack (verifiable).
3. Value — what those attributes enable for the customer (outcome, in their words).
4. Best-fit customers — who cares most about that value (firmographics + situation/trigger).
5. Market category — the frame that makes the value obvious (existing, sub-category, or new only if necessary).
Messaging hierarchy: one-line value proposition → 3 pillars (each = benefit + proof point) → objection handlers → CTA.
Value proposition formula: "[Product] helps [specific customer] [achieve outcome] without [main pain/tradeoff]".
Test: would a competitor say the same sentence? If yes, it's not positioning. Write 3 alternative angles (pain-led, outcome-led, identity-led) and pick per channel.`,
  },
  {
    name: "copywriting-frameworks",
    title: "Copywriting frameworks",
    description: "AIDA, PAS, BAB, 4U headlines, CTA writing, editing checklist for posts, ads and landing copy.",
    preloadFor: ["content_creation", "general", "community_management"],
    body: `Frameworks — pick one per piece:
- PAS: Problem (name it in their words) → Agitate (cost of inaction, specific) → Solution (how we fix it + proof).
- AIDA: Attention (hook) → Interest (surprising insight) → Desire (outcome + proof) → Action (single CTA).
- BAB: Before (current pain) → After (vivid outcome) → Bridge (product as the way).
- 4U headlines: Useful, Urgent, Unique, Ultra-specific. Score each 1–4; ship ≥12.
- Feature → benefit → "so that": "Auto-scheduling (feature) so you post at peak times (benefit) so that each post gets more reach (outcome)".
CTAs: verb + outcome + friction reducer ("Start free — no card", "Get the template", "See it in 60 seconds"). One CTA per asset.
Editing pass: cut 20% of words; replace vague words with numbers; one idea per sentence; read-aloud test; check grade ≤8; remove clichés ("game-changer", "elevate", "unlock", "seamless").
Voice: write like a smart friend in the industry — confident, plain, specific. Mirror customer vocabulary from reviews/comments.
Social copy: line 1 = hook (≤10 words), short lines, white space, 1–3 relevant hashtags max (except where platform norms differ), end with a question or CTA.`,
  },
  {
    name: "hooks-scroll-stoppers",
    title: "Hooks & scroll-stoppers",
    description: "Proven hook patterns for posts and short video openings, with how to pick and test them.",
    preloadFor: ["content_creation", "video_creation", "general"],
    body: `Hook patterns (adapt, don't copy):
- Contrarian: "Stop [common advice]. Do this instead."
- Specific result: "How we got [number] [result] in [time] with [constraint]."
- Mistake: "[N] mistakes that kill your [goal] (most do #3)."
- Curiosity gap: "The [thing] nobody talks about in [topic]."
- Direct callout: "If you [specific situation], read this."
- Before/after visual or "watch this" demo in the first second.
- Myth vs. fact, "I tried X for 30 days", "POV: you finally…", list-of-N with a payoff.
Rules: hook in the first line / first 1–1.5s; promise must be paid off; no clickbait the content can't deliver. For video, combine visual motion + on-screen text + spoken line saying the same promise.
Testing: write 5–10 hooks per idea, pick 2–3 most specific, ship as variants; keep a hooks swipe file in /workspace/hooks.md with results.`,
  },
  {
    name: "platform-playbooks",
    title: "Platform playbooks",
    description: "What works natively on TikTok, Instagram, X, LinkedIn, YouTube Shorts — formats, length, cadence, specs.",
    preloadFor: ["content_creation", "social_publishing", "general", "marketing_strategy"],
    body: `TikTok: 9:16, 15–45s sweet spot, hook <1.5s, native/lo-fi beats polished ads, captions on screen, trending sounds when on-brand, 1 idea per video, 3–5 posts/week, reply to comments with videos. Specs 1080×1920.
Instagram: Reels (9:16, 7–30s, cover frame matters) for reach; carousels (4:5 1080×1350, 5–10 slides: hook slide → value → CTA slide) for saves/shares; single image 4:5. Captions: hook line, value, CTA ("save this", "share with…"). Stories for engagement (polls, questions). 3–5 Reels/week.
X: text-first; strong first line; threads for depth (hook tweet + 5–10 tweets + CTA); images 16:9 1600×900 or 1:1; post 1–3×/day; reply to big accounts in niche with real insight; avoid link in the first tweet when reach matters.
LinkedIn: personal-story + lesson format, first 2 lines before "see more" decide it, document/carousel posts perform, 1 link in comments, professional but human, 3–5×/week.
YouTube Shorts: 9:16 <60s, loopable endings, title + on-screen hook.
Timing: post when the audience is active (use analytics), keep a consistent cadence over volume spikes.
Repurposing: 1 pillar piece (blog/video/webinar) → 5–10 native cuts (thread, carousel, 3 shorts, quote graphic, newsletter section).`,
  },
  {
    name: "campaign-strategy",
    title: "Campaign strategy",
    description: "Plan campaigns end-to-end: objective, audience, big idea, channel mix, calendar, budget, KPIs.",
    preloadFor: ["marketing_strategy", "general"],
    body: `Campaign brief template:
1. Objective (one) + KPI + target number + date.
2. Audience segment + trigger moment + key insight (truth that makes the idea work).
3. Big idea / theme in one line; why now (trend, launch, season).
4. Offer & CTA (what exactly do they get/do).
5. Channel mix: owned (site, email, social), earned (PR, creators, community), paid — role of each (reach vs. conversion).
6. Content plan: hero asset(s), supporting pieces per channel, cadence (launch burst then sustain).
7. Calendar: teaser → launch → proof → urgency/close → recap.
8. Budget & guardrails; approval needs.
9. Measurement: UTM per link, baseline, check-in dates, success/kill criteria.
Funnel thinking: TOFU (hooks, trends, education) → MOFU (proof, comparisons, demos) → BOFU (offers, objection handling, testimonials, urgency). Retarget engagers.`,
  },
  {
    name: "trend-jacking",
    title: "Trend-jacking",
    description: "Turn Social Pulse trends into on-brand content fast — fit test, angle, speed, risk check.",
    preloadFor: ["trend_research", "content_creation", "general"],
    body: `Use get_social_pulse (and research_trends) for real, sourced trends. For each candidate:
1. Fit test (score 0–3 each): audience overlap, brand has a genuine angle, can ship within 24–48h, low risk. Ship only ≥8/12.
2. Angle: connect the trend to the customer's problem or the product's truth — "What does this trend mean for [audience]?" not "brand inserts itself".
3. Format: use the trend's native format (sound/meme template/hashtag) where on-brand; otherwise a fast take (thread, carousel, short).
4. Speed > polish for trends; evergreen content gets the polish.
5. Risk check: no tragedies, politics, protected-group jokes, or copyrighted audio/footage outside platform libraries. Credit creators.
6. Cite the trend source URL in drafts/notes. Track results to learn which trend types work.`,
  },
  {
    name: "conversion-optimization",
    title: "Conversion optimization (CRO)",
    description: "Landing page and funnel fixes: clarity, friction, trust, CTA, mobile, with a prioritized test plan.",
    preloadFor: ["website_audit", "website_code", "growth_experiments"],
    body: `Above the fold: headline = outcome for a specific audience; subhead = how + proof; primary CTA visible; product visual showing the result; trust row (logos/reviews/numbers — real only).
Page flow: problem → solution → how it works (3 steps) → benefits (with proof) → social proof → objections/FAQ → pricing/offer → final CTA.
Friction: fewer form fields, clear next step, fast load (<2.5s LCP), mobile tap targets, no surprise costs, guest checkout.
Trust: specific testimonials with names/roles (real), guarantees, security, transparent pricing.
Prioritize with ICE (Impact, Confidence, Ease); test one hypothesis at a time; define the metric and minimum sample before shipping. Write fixes as concrete diffs or copy, not advice.`,
  },
  {
    name: "growth-experiments",
    title: "Growth experiments",
    description: "Design and evaluate experiments: hypothesis, metric, sample, duration, decision rules.",
    preloadFor: ["growth_experiments", "analytics"],
    body: `Experiment card: Hypothesis ("Because [insight], we believe [change] for [audience] will [increase metric] by [x%]") · Primary metric + guardrail metric · Variant(s) · Audience/traffic · Duration & minimum sample · Decision rule (ship / iterate / kill) · Owner.
Prefer high-velocity, low-cost tests (hooks, thumbnails, CTAs, posting times, offers) before big builds. Keep a log in /workspace/experiments.md. Never claim a win without enough data; report effect size and uncertainty honestly.`,
  },
  {
    name: "analytics-insights",
    title: "Analytics → insights",
    description: "Read metrics correctly: engagement rate, reach vs impressions, attribution, what to do next.",
    preloadFor: ["analytics", "marketing_strategy"],
    body: `Report as: What happened (measured) → Why (evidence-based hypotheses, labelled) → What to do next (specific actions).
Key ratios: engagement rate = (likes+comments+shares+saves)/reach (or views); save & share rates signal value; comment rate signals conversation; CTR and conversion rate per UTM campaign.
Compare against the account's own baseline (median of last 20 posts), not vanity totals. Look for outliers (top/bottom 10%) and what they share (hook, format, topic, time). Separate correlation from causation. Never fill missing metrics with zero — say "not available".`,
  },
  {
    name: "community-voice",
    title: "Community & replies",
    description: "Reply playbook: tone, de-escalation, turning comments into content, escalation rules.",
    preloadFor: ["community_management"],
    body: `Reply fast, human, specific; use their name; answer the actual question; add value (tip/link) not just thanks. Negative feedback: acknowledge → take responsibility where due → concrete next step → move to DM for account details. Never argue, never share private data, escalate legal/safety/PR issues. Turn repeated questions into FAQ posts and content ideas (log them in /workspace/content-ideas.md).`,
  },
  {
    name: "brand-consistency",
    title: "Brand consistency",
    description: "Apply voice, visual identity and guardrails consistently across every asset.",
    preloadFor: ["image_editing", "video_creation", "content_creation"],
    body: `Read get_project_profile first: voice/tone, colors, fonts, logo, blocked topics, audience. Visual: use the brand palette (1 primary, 1 accent, neutrals), consistent typography, logo small and in a corner (not on every frame), consistent layout grids per series. Voice: keep sentence style, vocabulary and emoji usage consistent with past approved posts. Create series templates (same layout, different content) — recognizability compounds.`,
  },
  {
    name: "image-creative-direction",
    title: "Image creative direction (Seedream)",
    description: "Write prompts that produce clean, professional, on-brand images: structure, lighting, composition, text.",
    preloadFor: ["image_editing", "content_creation", "general"],
    body: `Prompt structure (one paragraph, most important first):
[Subject + action/state] · [Setting/background] · [Composition & framing: shot type, angle, rule of thirds, negative space for text] · [Lighting: soft studio light / golden hour / high-key] · [Style: commercial product photography / editorial / clean 3D render / flat vector illustration] · [Color palette: brand colors by name/hex] · [Mood] · [Quality cues: sharp focus, high detail, realistic textures, professional color grading].
Clean & professional defaults: uncluttered background, one focal point, generous negative space, consistent light direction, realistic materials, no random extra objects, no distorted hands/faces, no gibberish text.
Text in images: Seedream renders short text well — put exact text in quotes, ≤6 words, specify font style ("bold geometric sans-serif"), color and position ("top third, centered"). Longer copy goes in the caption or is added later with edit_image brand overlay.
Formats: feed 4:5 or 1:1 (use 1024x1536 for portrait, 1024x1024 square), stories/Reels covers 9:16 (generate portrait then preset story_9_16), X/LinkedIn 16:9 (1536x1024).
Product shots: hero angle (3/4), seamless or contextual lifestyle background, soft shadow, reflections controlled, product occupies 50–70% of frame.
People: diverse, natural expressions, real-life context matching the audience, avoid stock-photo clichés (pointing at laptops, handshakes).
Iterate: generate 2–4 variations, pick the cleanest, then edit_image (preset crop, brand overlay) rather than regenerating from scratch.`,
  },
  {
    name: "ad-creative-conversion",
    title: "Converting ad & social creatives",
    description: "Layout and messaging rules that make static creatives convert: hierarchy, CTA, proof, variants.",
    preloadFor: ["image_editing", "marketing_strategy", "content_creation"],
    body: `Visual hierarchy: 1 focal image (product-in-use or outcome) → headline (≤7 words, benefit) → proof element (rating, number, logo — real only) → CTA button/text. Readable at thumbnail size; 3-second test: can someone get the point in 3 seconds?
Contrast: text on solid/blurred area, ≥4.5:1 contrast, max 2 fonts, ≤20% of image area as text.
Angles to test: pain point, desired outcome, social proof, before/after, feature demo, offer/urgency, UGC style. Make 3–5 variants per angle changing one element.
Platform safe zones: keep text out of the bottom 20% and top 14% on 9:16 (UI overlays).
Thumb-stopping: bold color block from brand palette, faces looking toward the headline, unexpected visual metaphor, high contrast.
Always pair with caption copy (copywriting-frameworks) and a single CTA.`,
  },
  {
    name: "video-creative-direction",
    title: "Video creative direction (Seedance)",
    description: "Prompt and structure short videos: shot language, motion, pacing, first-frame strategy, hooks.",
    preloadFor: ["video_creation", "general"],
    body: `Seedance prompt structure: [Subject + clear action] · [Camera: shot size, movement (slow dolly in, orbit, handheld, static), angle] · [Setting & lighting] · [Style: cinematic commercial / realistic UGC / clean motion-graphic] · [Pacing & mood] · [Color palette]. Describe ONE continuous shot per clip (5–10s); build longer videos by generating several clips and assembling with edit_video (concat, subtitles).
First frame: for brand consistency, generate a clean on-brand image first (image-creative-direction) and pass it as imageAssetId so the video starts from it.
Structure for short-form ads (15–30s): 0–2s hook (motion + promise) → 2–10s problem/demo → 10–20s outcome/proof → last 3s CTA + logo. Add subtitles (most watch muted).
Motion: smooth, purposeful camera movement; avoid chaotic multi-action prompts, morphing objects, or text generated inside the video (add text with subtitles/overlays instead).
Formats: 9:16 for TikTok/Reels/Shorts, 1:1 or 16:9 for feeds/X. Keep the subject centered for safe zones.
Storyboard first (create_storyboard), then generate clip-by-clip and review each with analyze_media before assembling.`,
  },
];

export const skillIndex = () => SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n");

export function preloadedSkills(agentType: AgentType): Skill[] {
  return SKILLS.filter((s) => s.preloadFor.includes(agentType)).slice(0, 4);
}

export function getSkill(name: string): Skill | undefined {
  return SKILLS.find((s) => s.name === name.trim().toLowerCase());
}
