# Integrations: setup and capabilities

OAuth integrations (GA4, GitHub) need a developer app owned by you. Add its client ID and secret in **Settings → Developer apps** (stored encrypted per user) or in `.env`. Each provider's redirect URI is `${API_PUBLIC_URL}/api/oauth/<provider>/callback`. The exact URI is shown with a copy button on the Integrations page. Social accounts don't use OAuth: they're linked by URL (see below).

---

## Social accounts (Instagram, TikTok, X): linked by URL

SocialPilot **never posts and never logs in** to social networks. In a project, open **Integrations → Social accounts** (or the setup wizard) and paste the profile link, e.g. `https://www.instagram.com/yourbrand`, `https://www.tiktok.com/@yourbrand` or `https://x.com/yourbrand`. Social profiles found on your website can be linked with one click. No developer apps, OAuth or app review are needed.

What a linked account gives you (Analytics → **Your accounts**):

- With a **RapidAPI key** (Instagram Statistics API): followers and follower history, average engagement rate, quality score, fake followers, audience demographics, and the account's posts from the last 60 days. Each post has views, likes, comments, shares, engagement rate and a **performance grade** (A+…D against the account's own similar posts). You also see which **post formats, hashtags and caption lengths** perform best. Accounts refresh automatically every 7 days (2 requests each, within your monthly budget) or on demand with *Refresh*.
- Without it: posts you publish and link are still tracked for free (TikTok views/likes/comments/shares/saves, X likes/replies), and TikTok follower counts are captured from your video pages.

**Posting:** you post yourself from **Ready to post**. *Plan for later* in the post editor puts a post there at its planned time, and agents use `send_to_ready_to_post`. Old API-scheduled posts automatically become Ready-to-post items. The comment inbox needed API access to your accounts, so it's no longer part of the app.

**Plan my next posts** (Analytics): the AI reads your account analytics (what formats, hooks, hashtags and caption lengths perform), your posts' results and current trends. It then writes and illustrates the next posts and puts them on Ready to post at your best posting times, with a brief explaining the evidence in `/workspace/next-posts.md`.

## Google Analytics 4

- **Scopes:** `analytics.readonly`, `openid`, `email`
- **Setup:**
  1. Google Cloud Console → enable the **Google Analytics Data API** and **Google Analytics Admin API**.
  2. Configure the OAuth consent screen and add yourself as a test user.
  3. Create an OAuth client of type **Web application** with the redirect URI.
  4. Connect, then choose the GA4 property on the Integrations page.
- **Data:** daily sessions, users, pageviews, key events (conversions), referrers, top pages, and `sessionCampaignName` for UTM attribution. SocialPilot adds `utm_source/utm_medium/utm_campaign/utm_content` to links in posts automatically.

## Plausible

API key based. Create a Stats API key (Account → API keys) and enter the site domain. Self-hosted instances can set a base URL. Goals aren't queried, so conversions show as "not tracked".

## GitHub

- **Scopes:** `repo`, `read:user`, `workflow`
- **Setup:** GitHub → Settings → Developer settings → OAuth Apps → New. Set the callback URL, generate a secret, connect, then pick the repository and base branch.
- **Behavior:** the AI reads the tree and files (secret-looking paths are hidden and refused). It proposes changes as full file contents with a unified diff, pushes **a new branch** (`socialpilot/...`) and opens a PR. Checks and preview URLs come from GitHub check runs and statuses, and from Vercel deployment statuses. Merging needs explicit confirmation from you, or an approval for agents. Edits to `.github/workflows`, `.env*` and lockfiles are blocked.

## Vercel

Token based. Create an access token at vercel.com/account/tokens and enter the project ID or name (plus a team ID if needed). PR branches produce preview deployments through Vercel's Git integration. Promotion to production and instant rollback go through approvals by default. Each promotion records the previous production deployment for rollback.

---

## AI and data providers

| Provider | Used for | Key |
|---|---|---|
| **NVIDIA API Catalog** (recommended main AI) | Agents with tool calling (default `moonshotai/kimi-k2.6`), thinking/planning (`nvidia/nemotron-3-ultra-550b-a55b`), vision for images and sampled video frames (`nvidia/nemotron-3.5-super-vl-120b-a12b`, or `nvidia/cosmos-reason2-8b` for video), fast triage (`z-ai/glm-5.3-flash`). Each role is configurable per project. | `NVIDIA_API_KEY` or Settings |
| **ByteDance (BytePlus ModelArk)** (main image and video AI) | Image generation and edits with **Seedream 4.0** (`seedream-4-0-250828`, default; 5.0 Lite/Pro selectable) and video with **Seedance 1.0 Pro Fast** (`seedance-1-0-pro-fast-251015`, default: 1080p, 2–12 s, text-to-video or from a first frame; 1.0 Pro and 2.0 selectable). One API key covers both. | `BYTEPLUS_API_KEY` (+ optional `BYTEPLUS_BASE_URL`) |
| Anthropic | Agents (tool use), text, vision. Default model `claude-opus-5-5`; server-side refusal fallback enabled | `ANTHROPIC_API_KEY` or Settings |
| OpenAI | Agents (tool use), text, `gpt-image-1` generation and edits, Whisper subtitles | `OPENAI_API_KEY` |
| Google Gemini | Text and vision (not used for agents) | `GEMINI_API_KEY` |
| **Ollama Cloud** | Hosted open models with an API key, no install: agents (`gpt-oss:120b`, `kimi-k2:1t`), thinking (`deepseek-v3.1:671b`), vision (`qwen3-vl:235b`), fast (`gpt-oss:20b`) | `OLLAMA_API_KEY` or Settings |
| Replicate | FLUX images, FLUX Kontext edits, background removal, video (MiniMax, Kling) | `REPLICATE_API_TOKEN` |
| Stability AI | Image generation, background removal | `STABILITY_API_KEY` |
| NewsAPI / Product Hunt | Extra Discover sources | Settings → Data sources |
| PageSpeed Insights | Lighthouse scores in audits (works keyless at low quota) | optional |

**Ollama Cloud:** create an API key at ollama.com/settings/keys and add it on the Ollama Cloud row in Settings → AI providers. Nothing is installed locally. **Model & reasoning** lists the models available to your key. Ollama Cloud is used after the other built-in text providers unless a project or role picks it explicitly.

**Custom providers:** in Settings → AI providers → **Custom providers → Add provider** you can add any OpenAI-compatible API: OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Fireworks, self-hosted vLLM, Ollama or LM Studio (presets included). For each one you set:

- the base URL and an optional API key (stored encrypted);
- what it can do: text, tool calling (needed for agents), vision, image generation (`/images/generations`);
- its model ids and default model per role;
- optional prices for budget tracking.

It then appears in every model-role picker. Remote URLs must use HTTPS. Localhost/private URLs are allowed only when `ALLOW_LOCAL_AI_ENDPOINTS` is on (default outside production); cloud-metadata addresses are always blocked. Video generation stays on Seedance/Replicate because there is no common video API standard.

**Model & reasoning per provider:** every provider with a key, built-in or custom, has a **Model & reasoning** button in Settings → AI providers. For each job (Main AI, Thinking & planning, Vision, Fast tasks, Image, Video) you can pick the model and how much it reasons. Leave the model empty to use the default; a project can still override the model in Project settings → AI & budget. Reasoning levels map to each API:

| Provider | Levels | Sent as |
|---|---|---|
| Anthropic | low → max | Claude `effort` (adaptive thinking) |
| OpenAI | minimal → high | `reasoning_effort` (reasoning models only) |
| Gemini | off, low, medium, high | `thinkingConfig.thinkingBudget` (0 / 1k / 8k / 24k) |
| Ollama | off, on, low, medium, high, max | `reasoning_effort` (`none` for off) |
| NVIDIA and custom | off, on, low, medium, high | `chat_template_kwargs.thinking` (on/off) or `reasoning_effort` (low/medium/high) |

"Provider default" sends nothing. Choose only levels the selected model supports; otherwise the provider returns an error, which the app shows.

**Model roles:** each project picks a provider and model for *Main AI*, *Thinking & planning*, *Vision*, *Fast tasks*, *Image generation* and *Video generation* (Project settings → AI). Main models without native vision get attachments described by the vision model, and agents have an `analyze_media` tool that sends images, or FFmpeg-sampled video frames, to the vision model.

**Marketing and creative skills:** every agent works from built-in marketing principles plus expert playbooks: positioning, copywriting frameworks, hooks, platform playbooks, campaign strategy, trend-jacking, conversion optimization, growth experiments, analytics, community replies, brand consistency, image creative direction, converting ad creatives and video creative direction. The playbooks that fit an agent's job are preloaded, and any agent can pull another with `load_skill`. The library is in `packages/engine/src/agents/skills.ts`. **Image and video generation runs a creative-director pass first:** your brief and the project's brand (colors, tone, audience) are turned into a production-grade Seedream or Seedance prompt with composition, lighting, style and quality details. The original brief and the final prompt are both saved on the asset version. If no text AI is configured, the brief is used as is.

Model IDs are free text in project AI settings, so newer models can be used without code changes. Cost estimates for budget enforcement are in `packages/shared/src/pricing.ts`.

---

## Publishing without APIs: Ready to post and post tracking

You don't need to connect any social account or developer app to publish and measure.

1. **Send to Ready to post.** In the post editor, click *Send to Ready to post*. A scheduled post for a platform that isn't connected also lands there at its planned time, and you get a notification.
2. **Ready to post** (sidebar) lists each item per platform with:
   - the final caption (platform variant, hashtags, CTA, UTM link on X) and a character count;
   - thread parts and video title;
   - a posting checklist;
   - **platform-ready media** — images converted to JPEG and fitted without cropping (Instagram 4:5–1.91:1, TikTok 1080×1920, X original aspect), downloadable one by one or as a ZIP with `caption.txt` and `POSTING-CHECKLIST.txt`.
3. Post it in the app, then click **I posted it** and paste the post link. The link is validated: it must match the platform, be a post (not a profile), and not already be attached. The item leaves the desk. *Not posted / wrong link* moves it back.
4. **Analytics → Post performance** tracks it on a decaying schedule: every 20 minutes for 48 hours, every 2 hours until day 7, every 12 hours until day 30, then daily until day 90. Each refresh is stored as a dated snapshot for growth charts.

| Platform | Collected automatically (free, public) | Add yourself (screenshot read by AI or typed) |
|---|---|---|
| TikTok | Views, likes, comments, shares, saves | Reach, watch time, profile visits, follows |
| X | Likes, replies (free); views and reposts with a RapidAPI key | Bookmarks, link clicks |
| Instagram | With a RapidAPI key: likes, comments, views (live, at 1/3/7 days) | Reach, shares, saves, profile visits, follows (Insights screenshot) |

**Screenshot import:** in a post's detail, click *Read screenshot* and upload the platform's analytics screen. The vision model reads only the visible numbers (abbreviations like 1.2K are flagged), and you confirm or correct them before saving. Values you add are never overwritten by automatic refreshes, and unknown values stay empty, never zero. The report shows totals, engagement rate (engagements ÷ views), per-platform breakdown, top posts and best posting days/hours once there is enough data. Agents read it with `get_post_performance` and `list_ready_to_post`.

**Why not scrape Instagram with Python?** Tested: instaloader without login gets `401 Please wait a few minutes` and `429 Too Many Requests` from Instagram. Logging in a scraper with your account risks the account and is against Instagram's terms. Screenshot import gives exact owner-only numbers instead.

## Social Pulse (every 20 minutes)

**Social Intel → Pulse** shows what is rising on social media right now, ranked by momentum (how fast a post, topic or search grows between crawls) and, if you pick a project, by how well it matches the project's keywords. The worker crawls every 20 minutes. Free sources are always on:

| Source | What | How |
|---|---|---|
| Bluesky | Trending topics | Public AppView API |
| Mastodon | Trending posts, hashtags and links, plus recent posts for up to 8 hashtags taken from your project keywords | mastodon.social public API |
| Google Trends | "Trending now" searches with linked news, per country | Public RSS |

Reddit, TikTok, Instagram and X have no free logged-out trend source (or they block bots), and SocialPilot doesn't work around that. **TikTok trending and Instagram trending Reels** are available through SocialCrawl as a paid opt-in under Pulse settings: off by default, 5 credits per platform per run, your own interval (≥ 20 min) and a **hard daily credit cap**. Every paid run is written to the audit log, and crawling stops at the cap. When new trends match a project, you get a notification, at most one every 2 hours per project. Agents read the pulse with the `get_social_pulse` tool.

## Social Intel (public profiles and posts)

**Social Intel** in the sidebar analyzes public TikTok, Instagram and X URLs without logging in to those platforms. Each data source is a separate adapter (`packages/integrations/src/intel/providers.ts`), so any one of them can be replaced. Every result carries a source label and a confidence level (`exact`, `rounded` or `partial`). A metric a source can't provide is listed as unavailable and never filled in with zero.

| Platform / URL | Free source | What you get | Not available for free |
|---|---|---|---|
| TikTok video | Public video page (logged-out page data) | Plays, likes, comments, shares, saves, publish time, caption; creator followers/likes/videos (rounded by TikTok) | Reach, watch time, demographics |
| TikTok profile | — (TikTok shows a verification page to non-browser clients) | Creator totals are captured whenever you analyze any of their videos | Exact stats + recent videos (SocialCrawl or Apify) |
| X post | X's public embedded-post data | Likes, replies, text, date, author | Impressions (PostPeer, via your connected X account) |
| X profile | — | — | Recent-post analytics for your own X account (PostPeer) |
| Instagram post / Reel / profile | — (login wall; Basic Display API was discontinued) | — | SocialCrawl or Apify; or the official API for your own professional account |

- **No evasion:** requests send an honest user agent, use no proxies, never solve CAPTCHAs and never use cookies or logins. These free sources can stop working whenever a platform changes its pages; when that happens the app reports it rather than guessing.
- **Watchlist:** watched items get a snapshot every 20 minutes from **free sources only**. Charts and change tables use snapshots SocialPilot itself recorded; those changes are not unique viewers.
- **Exports:** CSV export includes every snapshot. Missing metrics stay blank.

### Instagram Statistics API (RapidAPI)

Add your RapidAPI key (Settings → Data sources, or `RAPIDAPI_KEY`) and subscribe to [Instagram Statistics API](https://rapidapi.com/artemlipko/api/instagram-statistics-api). It covers Instagram, TikTok and X:

- **Social Intel → any profile URL:** followers, average engagement rate, likes/views per post, **quality score**, **fake followers**, follower growth (180 days), audience types (real / mass followers / suspicious), **audience countries, cities, gender and age**, brand-safety flags and the latest posts. 1 request per lookup, after you confirm.
- **Instagram post URLs:** live likes, comments and views (*Post by URL*), 1 request.
- **Your posted content (Analytics → Post performance):** Instagram posts get live likes, comments and views, and X posts get views and reposts from the account feed. This runs automatically at 1, 3 and 7 days after posting (toggle *Auto-track*) or with the *Live numbers* button. TikTok stays on the free public source.

**Quota and cost:** every request counts. The Basic plan is 50 requests/month with a **hard limit** (no overage), and paid plans bill overage. SocialPilot reads the quota headers on every response, shows usage against your **monthly budget** (default 45), and never goes over it. Automatic tracking also keeps 5 requests in reserve for your own lookups. Each request is logged in the audit log. The provider updates popular accounts daily and less popular ones weekly to monthly; data dates are shown with each result.

### Paid, opt-in sources

Add keys in Settings → Data sources (or `.env`). **Every paid lookup needs a confirmation for that request; the watchlist and scheduler never use them.** The confirmation shows the cost and, for credit sources, your remaining balance.

- **SocialCrawl** (`SOCIALCRAWL_API_KEY`, socialcrawl.dev; 100 free credits): public TikTok and Instagram profiles and posts. A post costs 1 credit; a profile with one page of recent posts costs 2. SocialCrawl refunds not-found and failed lookups, and repeat lookups within 10–15 minutes are free cache hits.
- **PostPeer** (`POSTPEER_API_KEY`, postpeer.dev; 20 free credits a month): X analytics (impressions, likes, replies) for X accounts **you** connect to PostPeer. Click **Connect X** on the Social Intel page, authorize in the new tab, then **Refresh**. Each lookup costs 1 credit. PostPeer can't read accounts you haven't connected.

Apify (`APIFY_API_TOKEN`) is also available, with a hard USD spend cap per request:

- **Instagram Scraper** (`apify/instagram-scraper`, about $2.30–2.70 per 1,000 results): profile details plus recent posts, or a single post/Reel.
- **TikTok Scraper** (`clockworks/tiktok-scraper`, from $1.70 per 1,000 results): profile plus recent videos.
- **Website traffic estimate** (`santhej/website-traffic-intel`, about $0.16 per domain): an SEO estimate of monthly organic search traffic, ranking keywords and search competitors. It's an estimate, not measured visits. It appears on each project's Analytics page and under Social Intel → Website traffic.

On Apify's free plan, usage draws on the monthly free credit and stops at the plan limit.

**Why not ig-monitoring?** The open-source jakim/ig-monitoring was archived in February 2023, relied on Instagram endpoints that now require login, and needs rotating proxies. That conflicts with the rule against evading platform protections, so SocialCrawl covers public Instagram data instead.
