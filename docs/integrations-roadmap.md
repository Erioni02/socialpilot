# Integrations roadmap and what you need to set up

SocialPilot only uses official APIs and OAuth. It never asks for social media passwords or browser cookies. Each integration below is built in the cycle shown. Some platforms require developer registration, app review, or a paid API tier before anything can work; those steps can only be done by you, as the account owner.

| Integration | Cycle | What you need to do | Scopes / access it will request | What it enables |
|---|---|---|---|---|
| **Instagram** | 3 | Convert to an Instagram **Business or Creator** account and link it to a Facebook Page. Create a Meta developer app with the Instagram Graph API. Pass **Meta App Review** for publishing and comment permissions. | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `pages_show_list` | Account insights, publishing images/carousels/reels, reading and replying to comments |
| **TikTok** | 3 | Create a TikTok for Developers app with Login Kit and the **Content Posting API**. Until TikTok audits the app, posts can only be private. | `user.info.basic`, `video.upload`, `video.publish`, `video.list` | Uploading and publishing videos, publish status, basic video stats |
| **X (Twitter)** | 3 | Create an X developer project and app with OAuth 2.0. Posting and reading mentions require a **paid API tier**; check the current pricing on developer.x.com. | `tweet.read`, `tweet.write`, `users.read`, `offline.access` | Posting and threads, reading mentions, replies (with approval) |
| **Website analytics** | 4 | **GA4**: a Google Cloud project with the Analytics Data API enabled and an OAuth consent screen. **Or Plausible**: an API key. | GA4: `analytics.readonly` | Sessions, sources, conversions, UTM campaign attribution |
| **GitHub repository** | 4 | Register a **GitHub App** and install it on the website repository only. | Contents read/write, pull requests read/write, checks read | Reading code, changes on a separate branch, diffs, pull requests. Merging always needs your approval |
| **Deployment (Vercel)** | 4 | A Vercel access token scoped to the project's team. | Deployments read/create | Preview deployments and build logs. Production promotion needs your approval |
| **Image generation** | 2 | An API key for a supported image model provider. | n/a | Generating and editing images, saved as versioned assets |
| **Video generation** | 2 | An API key for a supported video model provider. FFmpeg is needed on the server (already installed on this machine). | n/a | Clips, subtitles, assembly |
| **News & trends** | 5 | Nothing for RSS, Hacker News and public GitHub data. Optionally, a news API key. | n/a | Discover briefings, always with source links and publish times |

## How the app represents this today (Cycle 1)

- Every project has an integration record per provider, all **Not connected**.
- The Integrations page and wizard step 5 show each card's requirements. There are no Connect buttons yet, because a button that can't do anything shouldn't be shown.
- The dashboard never shows follower counts, traffic or trends without a connected source. It shows a prompt instead.
- When a cycle ships an integration, its card gets a working **Connect** button that runs the platform's official OAuth flow. Tokens are stored encrypted (AES-256-GCM) on the server, and you'll be able to see granted scopes, last sync, errors, and reconnect or disconnect.
