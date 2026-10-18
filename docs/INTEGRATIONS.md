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
| Anthropic | Agents (tool use), text, vision. Default model `claude-opus-5-5`; server-side refusal fallback enabled | `ANTHROPIC_API_KEY` or Settings |
| OpenAI | Agents (tool use), text, `gpt-image-1` generation and edits, Whisper subtitles | `OPENAI_API_KEY` |
| Google Gemini | Text and vision (not used for agents) | `GEMINI_API_KEY` |
| Replicate | FLUX images, FLUX Kontext edits, background removal, video (MiniMax, Kling) | `REPLICATE_API_TOKEN` |
| Stability AI | Image generation, background removal | `STABILITY_API_KEY` |
| NewsAPI / Product Hunt | Extra Discover sources | Settings → Data sources |
| PageSpeed Insights | Lighthouse scores in audits (works keyless at low quota) | optional |

Model IDs are free text in project AI settings, so newer models can be used without code changes. Cost estimates for budget enforcement are in `packages/shared/src/pricing.ts`.
