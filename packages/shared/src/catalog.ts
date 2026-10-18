import type { AiProviderId, DataProviderId, IntegrationKind, IntegrationProvider } from "./enums";

export interface IntegrationCatalogEntry {
  id: IntegrationProvider;
  name: string;
  kind: IntegrationKind;
  authType: "oauth2" | "api_key" | "token";
  description: string;
  /** App-level developer credentials needed for OAuth (from env or the Developer Apps settings). */
  appCredentialFields?: { key: "clientId" | "clientSecret"; label: string; envVar: string }[];
  /** User-supplied connection fields for token / key based integrations. */
  connectFields?: { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }[];
  defaultScopes: string[];
  docsUrl: string;
  setupSteps: string[];
  requirements: string[];
}

export const INTEGRATION_CATALOG: Record<IntegrationProvider, IntegrationCatalogEntry> = {
  instagram: {
    id: "instagram",
    name: "Instagram",
    kind: "social",
    authType: "oauth2",
    description: "Instagram API with Instagram Login: profile, insights, publishing, comments.",
    appCredentialFields: [
      { key: "clientId", label: "Instagram App ID", envVar: "INSTAGRAM_CLIENT_ID" },
      { key: "clientSecret", label: "Instagram App Secret", envVar: "INSTAGRAM_CLIENT_SECRET" },
    ],
    defaultScopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_comments",
      "instagram_business_manage_insights",
    ],
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login",
    setupSteps: [
      "Create an app at developers.facebook.com (type: Business) and add the “Instagram” product → “API setup with Instagram login”.",
      "Under “Set up Instagram business login”, add the redirect URI shown below to “Valid OAuth Redirect URIs”.",
      "Copy the Instagram App ID and Instagram App Secret into SocialPilot (Settings → Developer apps) or the .env file.",
      "While the app is in Development mode, add your Instagram account as an Instagram Tester (App roles) and accept the invite in Instagram.",
      "To use the app with accounts that are not testers, submit the permissions for App Review and complete Business Verification.",
    ],
    requirements: [
      "Instagram Business or Creator account (personal accounts are not supported).",
      "Publishing requires media hosted at a public HTTPS URL — set PUBLIC_BASE_URL to a URL Instagram can reach.",
    ],
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    kind: "social",
    authType: "oauth2",
    description: "TikTok Login Kit + Content Posting API: profile stats, video list, video and photo posting.",
    appCredentialFields: [
      { key: "clientId", label: "Client key", envVar: "TIKTOK_CLIENT_KEY" },
      { key: "clientSecret", label: "Client secret", envVar: "TIKTOK_CLIENT_SECRET" },
    ],
    defaultScopes: ["user.info.basic", "user.info.profile", "user.info.stats", "video.list", "video.publish", "video.upload"],
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    setupSteps: [
      "Create an app at developers.tiktok.com and add the Login Kit and Content Posting API products.",
      "Enable “Direct Post” in the Content Posting API configuration.",
      "Add the redirect URI shown below under Login Kit → Redirect URI.",
      "Request the scopes user.info.basic, user.info.profile, user.info.stats, video.list, video.publish and video.upload.",
      "For photo posts or PULL_FROM_URL videos, verify the domain/URL prefix of PUBLIC_BASE_URL in the developer portal.",
      "Submit the app for audit. Until approved, all posts are restricted to private (SELF_ONLY) visibility.",
    ],
    requirements: [
      "TikTok does not offer a comments API to third-party apps; comments use a manual handoff.",
      "Unaudited apps can only publish private posts and only for up to 5 users.",
    ],
  },
  x: {
    id: "x",
    name: "X",
    kind: "social",
    authType: "oauth2",
    description: "X API v2 with OAuth 2.0 PKCE: posts, threads, media, mentions and replies.",
    appCredentialFields: [
      { key: "clientId", label: "OAuth 2.0 Client ID", envVar: "X_CLIENT_ID" },
      { key: "clientSecret", label: "OAuth 2.0 Client Secret", envVar: "X_CLIENT_SECRET" },
    ],
    defaultScopes: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"],
    docsUrl: "https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code",
    setupSteps: [
      "Create a project and app at developer.x.com.",
      "In “User authentication settings”, enable OAuth 2.0, choose “Web App, Automated App or Bot” (confidential client) and set app permissions to “Read and write”.",
      "Add the callback URI shown below and your website URL.",
      "Copy the OAuth 2.0 Client ID and Client Secret into SocialPilot or the .env file.",
      "Check that your API access plan includes the endpoints you need — reading posts, mentions and metrics requires paid access.",
    ],
    requirements: ["Read endpoints (timelines, mentions, metrics) require a paid X API plan or pay-per-use credits."],
  },
  ga4: {
    id: "ga4",
    name: "Google Analytics 4",
    kind: "analytics",
    authType: "oauth2",
    description: "GA4 Data API: sessions, users, conversions (key events), referrals and UTM campaigns.",
    appCredentialFields: [
      { key: "clientId", label: "Google OAuth client ID", envVar: "GOOGLE_CLIENT_ID" },
      { key: "clientSecret", label: "Google OAuth client secret", envVar: "GOOGLE_CLIENT_SECRET" },
    ],
    defaultScopes: ["https://www.googleapis.com/auth/analytics.readonly", "openid", "email"],
    docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
    setupSteps: [
      "In Google Cloud Console, create a project and enable the “Google Analytics Data API” and “Google Analytics Admin API”.",
      "Configure the OAuth consent screen (External) and add your Google account as a test user.",
      "Create an OAuth client ID of type “Web application” and add the redirect URI shown below.",
      "Copy the client ID and secret into SocialPilot or the .env file, then click Connect and choose your GA4 property.",
    ],
    requirements: ["A GA4 property with the tag installed on the website."],
  },
  plausible: {
    id: "plausible",
    name: "Plausible Analytics",
    kind: "analytics",
    authType: "api_key",
    description: "Privacy-friendly analytics via the Plausible Stats API v2.",
    connectFields: [
      { key: "siteId", label: "Site domain (site_id)", placeholder: "vibejudge.app" },
      { key: "apiKey", label: "Stats API key", secret: true },
      { key: "baseUrl", label: "Base URL (self-hosted only)", placeholder: "https://plausible.io", optional: true },
    ],
    defaultScopes: ["stats:read"],
    docsUrl: "https://plausible.io/docs/stats-api",
    setupSteps: [
      "In Plausible, open Account settings → API keys and create a Stats API key.",
      "Enter the site domain exactly as configured in Plausible.",
    ],
    requirements: [],
  },
  github: {
    id: "github",
    name: "GitHub",
    kind: "repository",
    authType: "oauth2",
    description: "Read repository files, create branches and commits, open pull requests and read check runs.",
    appCredentialFields: [
      { key: "clientId", label: "OAuth App client ID", envVar: "GITHUB_CLIENT_ID" },
      { key: "clientSecret", label: "OAuth App client secret", envVar: "GITHUB_CLIENT_SECRET" },
    ],
    defaultScopes: ["repo", "read:user", "workflow"],
    docsUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps",
    setupSteps: [
      "Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.",
      "Set the Authorization callback URL to the redirect URI shown below.",
      "Generate a client secret and copy the client ID and secret into SocialPilot or the .env file.",
      "After connecting, pick the repository and base branch for this project.",
    ],
    requirements: ["The AI only writes to new branches. Merging is gated by the project's approval policy."],
  },
  vercel: {
    id: "vercel",
    name: "Vercel",
    kind: "deployment",
    authType: "token",
    description: "List deployments, read build status and promote/rollback with approval.",
    connectFields: [
      { key: "token", label: "Vercel access token", secret: true },
      { key: "teamId", label: "Team ID (optional)", optional: true, placeholder: "team_..." },
      { key: "projectId", label: "Project ID or name", placeholder: "vibejudge" },
    ],
    defaultScopes: ["deployments"],
    docsUrl: "https://vercel.com/docs/rest-api",
    setupSteps: [
      "Create an access token at vercel.com/account/tokens scoped to the team that owns the project.",
      "Connect the GitHub repository to the Vercel project so that pull requests produce preview deployments.",
      "Enter the token and project name here.",
    ],
    requirements: ["Production promotion always goes through the approval queue by default."],
  },
};

export interface AiProviderCatalogEntry {
  id: AiProviderId;
  name: string;
  capabilities: ("text" | "vision" | "tools" | "image" | "image_edit" | "remove_background" | "video" | "transcription")[];
  envVar: string;
  /** True when the provider works without an API key (e.g. a local Ollama server). */
  keyOptional?: boolean;
  /** Extra non-secret fields stored with the key (e.g. BytePlus region URL). */
  extraFields?: { key: "accountId" | "baseUrl"; label: string; envVar: string; optional?: boolean; placeholder?: string }[];
  docsUrl: string;
  keyUrl?: string;
  defaultModels: Partial<Record<ModelRole | "image" | "video" | "transcription", string>>;
  models: { id: string; kind: "text" | "image" | "video" | "transcription"; label: string; roles?: ModelRole[] }[];
}

/** Which job a text model does: main (agents/tool use), reasoning (planning/analysis), vision (images & video frames), fast (cheap classification). */
export type ModelRole = "text" | "reasoning" | "vision" | "fast";

export const AI_PROVIDER_CATALOG: Record<AiProviderId, AiProviderCatalogEntry> = {
  nvidia: {
    id: "nvidia",
    name: "NVIDIA API Catalog (build.nvidia.com)",
    capabilities: ["text", "vision", "tools"],
    envVar: "NVIDIA_API_KEY",
    docsUrl: "https://docs.api.nvidia.com/nim/reference/llm-apis",
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    defaultModels: { text: "moonshotai/kimi-k2.6", reasoning: "nvidia/nemotron-3-ultra-550b-a55b", vision: "nvidia/nemotron-3.5-super-vl-120b-a12b", fast: "z-ai/glm-5.3-flash" },
    models: [
      { id: "moonshotai/kimi-k2.6", kind: "text", label: "Kimi K2.6 — main agent (tool calling)", roles: ["text"] },
      { id: "z-ai/glm-5.3", kind: "text", label: "GLM 5.3", roles: ["text", "reasoning"] },
      { id: "nvidia/nemotron-3-ultra-550b-a55b", kind: "text", label: "Nemotron 3 Ultra — reasoning", roles: ["reasoning", "text"] },
      { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", kind: "text", label: "Llama 3.1 Nemotron Ultra 253B — reasoning", roles: ["reasoning"] },
      { id: "nvidia/nemotron-3.5-super-vl-120b-a12b", kind: "text", label: "Nemotron 3.5 Super VL — vision", roles: ["vision"] },
      { id: "nvidia/cosmos-reason2-8b", kind: "text", label: "Cosmos Reason 2 — video/physical understanding", roles: ["vision"] },
      { id: "meta/llama-3.2-90b-vision-instruct", kind: "text", label: "Llama 3.2 90B Vision", roles: ["vision"] },
      { id: "z-ai/glm-5.3-flash", kind: "text", label: "GLM 5.3 Flash — fast/cheap", roles: ["fast"] },
      { id: "openai/gpt-oss-20b", kind: "text", label: "gpt-oss 20B — fast", roles: ["fast"] },
    ],
  },
  ollama: {
    id: "ollama",
    name: "Ollama Cloud",
    capabilities: ["text", "vision", "tools"],
    envVar: "OLLAMA_API_KEY",
    docsUrl: "https://docs.ollama.com/cloud",
    keyUrl: "https://ollama.com/settings/keys",
    defaultModels: { text: "gpt-oss:120b", reasoning: "deepseek-v3.1:671b", vision: "qwen3-vl:235b", fast: "gpt-oss:20b" },
    models: [
      { id: "gpt-oss:120b", kind: "text", label: "gpt-oss 120B (tools + reasoning effort)", roles: ["text", "reasoning"] },
      { id: "gpt-oss:20b", kind: "text", label: "gpt-oss 20B (fast)", roles: ["fast", "text"] },
      { id: "deepseek-v3.1:671b", kind: "text", label: "DeepSeek-V3.1 671B (thinking)", roles: ["reasoning", "text"] },
      { id: "kimi-k2:1t", kind: "text", label: "Kimi K2 1T (agents)", roles: ["text"] },
      { id: "qwen3-coder:480b", kind: "text", label: "Qwen3-Coder 480B (code)", roles: ["text"] },
      { id: "glm-4.6", kind: "text", label: "GLM-4.6", roles: ["text", "reasoning"] },
      { id: "qwen3-vl:235b", kind: "text", label: "Qwen3-VL 235B (vision)", roles: ["vision"] },
    ],
  },
  byteplus: {
    id: "byteplus",
    name: "ByteDance (BytePlus ModelArk) — Seedream images + Seedance video",
    capabilities: ["image", "image_edit", "video"],
    envVar: "BYTEPLUS_API_KEY",
    extraFields: [{ key: "baseUrl", label: "API base URL (optional)", envVar: "BYTEPLUS_BASE_URL", optional: true, placeholder: "https://ark.ap-southeast.bytepluses.com/api/v3" }],
    docsUrl: "https://docs.byteplus.com/en/docs/ModelArk",
    keyUrl: "https://console.byteplus.com/ark",
    defaultModels: { image: "seedream-5-0-260128", video: "dreamina-seedance-2-0-fast-260128" },
    models: [
      { id: "seedream-5-0-260128", kind: "image", label: "Seedream 5.0 Lite (default)" },
      { id: "seedream-5-0-pro-260628", kind: "image", label: "Seedream 5.0 Pro (best text rendering)" },
      { id: "seedream-4-0-250828", kind: "image", label: "Seedream 4.0" },
      { id: "dreamina-seedance-2-0-fast-260128", kind: "video", label: "Seedance 2.0 Fast" },
      { id: "dreamina-seedance-2-0-260128", kind: "video", label: "Seedance 2.0" },
    ],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    capabilities: ["text", "vision", "tools"],
    envVar: "ANTHROPIC_API_KEY",
    docsUrl: "https://docs.claude.com/en/api/overview",
    defaultModels: { text: "claude-opus-5-5" },
    models: [
      { id: "claude-opus-5-5", kind: "text", label: "Claude Opus 5.5 (default)" },
      { id: "claude-fable-5-1", kind: "text", label: "Claude Fable 5.1 (most capable)" },
      { id: "claude-sonnet-5-5", kind: "text", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", kind: "text", label: "Claude Haiku 5.5" },
    ],
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    capabilities: ["text", "vision", "tools", "image", "image_edit", "transcription"],
    envVar: "OPENAI_API_KEY",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    defaultModels: { text: "gpt-4.1", image: "gpt-image-1", transcription: "whisper-1" },
    models: [
      { id: "gpt-4.1", kind: "text", label: "GPT-4.1" },
      { id: "gpt-4.1-mini", kind: "text", label: "GPT-4.1 mini" },
      { id: "gpt-image-1", kind: "image", label: "GPT Image 1" },
      { id: "whisper-1", kind: "transcription", label: "Whisper" },
    ],
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    capabilities: ["text", "vision"],
    envVar: "GEMINI_API_KEY",
    docsUrl: "https://ai.google.dev/api",
    defaultModels: { text: "gemini-2.5-flash" },
    models: [
      { id: "gemini-2.5-pro", kind: "text", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", kind: "text", label: "Gemini 2.5 Flash" },
    ],
  },
  replicate: {
    id: "replicate",
    name: "Replicate",
    capabilities: ["image", "image_edit", "remove_background", "video"],
    envVar: "REPLICATE_API_TOKEN",
    docsUrl: "https://replicate.com/docs/reference/http",
    defaultModels: { image: "black-forest-labs/flux-schnell", video: "minimax/video-01" },
    models: [
      { id: "black-forest-labs/flux-schnell", kind: "image", label: "FLUX schnell" },
      { id: "black-forest-labs/flux-1.1-pro", kind: "image", label: "FLUX 1.1 pro" },
      { id: "black-forest-labs/flux-kontext-pro", kind: "image", label: "FLUX Kontext pro (edit)" },
      { id: "minimax/video-01", kind: "video", label: "MiniMax Video-01" },
      { id: "kwaivgi/kling-v2.1", kind: "video", label: "Kling v2.1" },
    ],
  },
  stability: {
    id: "stability",
    name: "Stability AI",
    capabilities: ["image", "image_edit", "remove_background"],
    envVar: "STABILITY_API_KEY",
    docsUrl: "https://platform.stability.ai/docs/api-reference",
    defaultModels: { image: "stable-image-core" },
    models: [
      { id: "stable-image-core", kind: "image", label: "Stable Image Core" },
      { id: "stable-image-ultra", kind: "image", label: "Stable Image Ultra" },
    ],
  },
};

export const DATA_PROVIDER_CATALOG: Record<DataProviderId, { name: string; envVar: string; description: string; docsUrl: string }> = {
  apify: { name: "Apify (paid, opt-in)", envVar: "APIFY_API_TOKEN", description: "Website traffic estimates and optional Instagram/TikTok scrapes. Runs only when you confirm a request, with a spend cap.", docsUrl: "https://console.apify.com/settings/integrations" },
  rapidapi: { name: "RapidAPI — Instagram Statistics API", envVar: "RAPIDAPI_KEY", description: "Instagram, TikTok and X account statistics (followers, engagement, quality score, fake followers, audience demographics) and live Instagram/X post metrics. Basic plan: 50 requests/month (hard limit); SocialPilot keeps to your monthly budget.", docsUrl: "https://rapidapi.com/artemlipko/api/instagram-statistics-api" },
  socialcrawl: { name: "SocialCrawl (paid credits, opt-in)", envVar: "SOCIALCRAWL_API_KEY", description: "Public TikTok and Instagram profiles and posts in Social Intel. 1 credit per lookup (100 free). Runs only when you confirm a request.", docsUrl: "https://www.socialcrawl.dev/docs/authentication" },
  postpeer: { name: "PostPeer (paid credits, opt-in)", envVar: "POSTPEER_API_KEY", description: "X post analytics (impressions, likes, replies) for X accounts you connect to PostPeer. 1 credit per lookup (20 free/month). Runs only when you confirm a request.", docsUrl: "https://www.postpeer.dev/docs/authentication" },
  newsapi: { name: "NewsAPI", envVar: "NEWSAPI_KEY", description: "Headline and keyword news search.", docsUrl: "https://newsapi.org/docs" },
  producthunt: { name: "Product Hunt", envVar: "PRODUCTHUNT_TOKEN", description: "Today's launches via the GraphQL API v2.", docsUrl: "https://api.producthunt.com/v2/docs" },
  pagespeed: { name: "PageSpeed Insights", envVar: "PAGESPEED_API_KEY", description: "Lighthouse performance & accessibility measurements.", docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started" },
  github_public: { name: "GitHub (public data)", envVar: "GITHUB_PUBLIC_TOKEN", description: "Optional token to raise GitHub public search rate limits.", docsUrl: "https://docs.github.com/en/rest/search" },
};
