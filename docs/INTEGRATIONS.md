# Integrations: setup and capabilities

Every OAuth integration needs a developer app owned by you. Add its client ID and secret in **Settings → Developer apps** (stored encrypted per user) or in `.env`. Each provider's redirect URI is:

```
${API_PUBLIC_URL}/api/oauth/<provider>/callback
```

With the defaults that is `http://localhost:4000/api/oauth/<provider>/callback`. The exact URI is shown with a copy button on the Integrations page. Some providers reject `http://localhost`. In that case, run the API behind HTTPS (a tunnel or your deployed domain) and set `API_PUBLIC_URL` to match.

**Media publishing needs a public URL.** Instagram (all media) and TikTok (photo posts) download media from a URL. Set `PUBLIC_BASE_URL` to an HTTPS address where `/public/media/*` on the API is reachable. Those links are HMAC-signed and expire after 6 hours.

After connecting, SocialPilot calls the provider's read endpoints and stores per-operation **connection test results**. The capability registry (`packages/shared/src/capabilities.ts`) combined with your granted scopes decides what the AI may attempt. Unsupported operations come back to the agent and the UI with the reason and an alternative.

---

## Instagram (Instagram API with Instagram Login)

- **Scopes:** `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights`
- **Setup:**
  1. developers.facebook.com → Create app (Business) → add **Instagram** → *API setup with Instagram login*.
  2. Add the redirect URI under *Business login settings*.
  3. Copy the **Instagram App ID / Secret** (not the Facebook App ID) into SocialPilot.
  4. In development mode, add your account as an **Instagram Tester** and accept the invite in the Instagram app.
  5. For accounts that aren't testers: App Review for each permission, plus Business Verification.
- **Requires:** a Business or Creator account.
- **Supported:** profile, followers, reach/views/interactions insights, media list, image/carousel/Reel publishing (JPEG images; container flow with resumable state), comments and replies.
- **Not supported:** text-only posts (use an image), native scheduling (SocialPilot schedules), mentions (webhooks for approved apps only).
- **Limits:** 100 API-published posts per 24h. Long-lived tokens (60 days) are refreshed automatically by the worker.

## TikTok (Login Kit + Content Posting API)

- **Scopes:** `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`, `video.publish`, `video.upload`
- **Setup:**
  1. developers.tiktok.com → create app → add **Login Kit** and **Content Posting API** → enable **Direct Post**.
  2. Add the redirect URI. Request the scopes above.
  3. For photo posts, verify the domain or URL prefix of `PUBLIC_BASE_URL`.
  4. Submit for audit. **Unaudited apps can only post privately (`SELF_ONLY`) for up to 5 users.**
- **Supported:** profile stats, video list with metrics, video upload (`FILE_UPLOAD`, chunked), photo posts (`PULL_FROM_URL`), publish status polling. Privacy level is chosen per post from the creator's allowed options.
- **Not supported:** comments and mentions. TikTok exposes no comments API to third-party apps, so the inbox shows a manual handoff to TikTok Studio.

## X (API v2, OAuth 2.0 Authorization Code + PKCE)

- **Scopes:** `tweet.read`, `tweet.write`, `users.read`, `offline.access`, `media.write`
- **Setup:**
  1. developer.x.com → project and app → *User authentication settings*: OAuth 2.0, type "Web App, Automated App or Bot", permissions **Read and write**.
  2. Add the callback URI. Copy the **OAuth 2.0 Client ID and Secret**.
  3. Make sure your API access plan covers what you need. Posting is widely available, but **reading timelines, mentions and metrics requires paid access or pay-per-use credits**. Without it those calls return a provider error that SocialPilot shows on the integration card.
- **Supported:** posts, threads (resumable: a retry continues from the last posted part), images (up to 4) and video (chunked v2 upload), public metrics, mentions and replies.

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
| **Cloudflare Workers AI** | Image generation (FLUX.1 schnell by default; SDXL models available) and img2img edits | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| **ByteDance Seedance** (BytePlus ModelArk) | Video generation (text-to-video, first-frame image-to-video) | `BYTEPLUS_API_KEY` (+ optional `BYTEPLUS_BASE_URL`) |
| Anthropic | Agents (tool use), text, vision. Default model `claude-opus-5-5`; server-side refusal fallback enabled | `ANTHROPIC_API_KEY` or Settings |
| OpenAI | Agents (tool use), text, `gpt-image-1` generation and edits, Whisper subtitles | `OPENAI_API_KEY` |
| Google Gemini | Text and vision (not used for agents) | `GEMINI_API_KEY` |
| Replicate | FLUX images, FLUX Kontext edits, background removal, video (MiniMax, Kling) | `REPLICATE_API_TOKEN` |
| Stability AI | Image generation, background removal | `STABILITY_API_KEY` |
| NewsAPI / Product Hunt | Extra Discover sources | Settings → Data sources |
| PageSpeed Insights | Lighthouse scores in audits (works keyless at low quota) | optional |

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
| NVIDIA and custom | off, on, low, medium, high | `chat_template_kwargs.thinking` (on/off) or `reasoning_effort` (low/medium/high) |

"Provider default" sends nothing. Choose only levels the selected model supports; otherwise the provider returns an error, which the app shows.

**Model roles:** each project picks a provider and model for *Main AI*, *Thinking & planning*, *Vision*, *Fast tasks*, *Image generation* and *Video generation* (Project settings → AI). Main models without native vision get attachments described by the vision model, and agents have an `analyze_media` tool that sends images, or FFmpeg-sampled video frames, to the vision model.

Model IDs are free text in project AI settings, so newer models can be used without code changes. Cost estimates for budget enforcement are in `packages/shared/src/pricing.ts`.

---

## Social Intel (public profiles and posts)

**Social Intel** in the sidebar analyzes public TikTok, Instagram and X URLs without logging in to those platforms. Each data source is a separate adapter (`packages/integrations/src/intel/providers.ts`), so any one of them can be replaced. Every result carries a source label and a confidence level (`exact`, `rounded` or `partial`). A metric a source can't provide is listed as unavailable and never filled in with zero.

| Platform / URL | Free source | What you get | Not available for free |
|---|---|---|---|
| TikTok video | Public video page (logged-out page data) | Plays, likes, comments, shares, saves, publish time, caption; creator followers/likes/videos (rounded by TikTok) | Reach, watch time, demographics |
| TikTok profile | — (TikTok shows a verification page to non-browser clients) | Creator totals are captured whenever you analyze any of their videos | Profile post list (paid Apify option) |
| X post | X's public embedded-post data | Likes, replies, text, date, author | Views, reposts, quotes (paid X API only) |
| X profile | — | — | Followers and post counts (paid X API only). Connect your own account for official metrics |
| Instagram post / Reel / profile | — (login wall; Basic Display API was discontinued) | — | Use the official API for your own professional account, or the paid Apify option |

- **No evasion:** requests send an honest user agent, use no proxies, never solve CAPTCHAs and never use cookies or logins. These free sources can stop working whenever a platform changes its pages; when that happens the app reports it rather than guessing.
- **Watchlist:** watched items get a snapshot about every 6 hours from **free sources only**. Charts and change tables use snapshots SocialPilot itself recorded; those changes are not unique viewers.
- **Exports:** CSV export includes every snapshot. Missing metrics stay blank.

### Paid, opt-in sources (Apify)

With an Apify token (Settings → Data sources, or `APIFY_API_TOKEN`) you can run these. **Each request needs a confirmation and has a hard spend cap; the app never runs them on a schedule.**

- **Instagram Scraper** (`apify/instagram-scraper`, about $2.30–2.70 per 1,000 results): profile details plus recent posts, or a single post/Reel.
- **TikTok Scraper** (`clockworks/tiktok-scraper`, from $1.70 per 1,000 results): profile plus recent videos.
- **Website traffic estimate** (`santhej/website-traffic-intel`, about $0.16 per domain): an SEO estimate of monthly organic search traffic, ranking keywords and search competitors. It's an estimate, not measured visits. It appears on each project's Analytics page and under Social Intel → Website traffic.

On Apify's free plan, usage draws on the monthly free credit and stops at the plan limit.
