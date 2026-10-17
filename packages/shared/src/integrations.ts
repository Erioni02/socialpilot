/**
 * What each integration will do and what the owner must set up for it. Shown on not-connected cards
 * so the UI is honest about what works today. Requirements reflect each platform's official API programs.
 */
export type IntegrationKey = "instagram" | "tiktok" | "x" | "website_analytics" | "github" | "deployment" | "image_gen" | "video_gen" | "news";

export type IntegrationInfo = { key: IntegrationKey; label: string; cycle: number; summary: string; needs: string[]; plannedCapabilities: string[] };

export const INTEGRATIONS: IntegrationInfo[] = [
  {
    key: "instagram",
    label: "Instagram",
    cycle: 3,
    summary: "Publish posts and reels, read insights and comments through the official Instagram Graph API.",
    needs: [
      "An Instagram Business or Creator account linked to a Facebook Page",
      "A Meta developer app with Instagram Graph API access",
      "Meta App Review for publishing and comment permissions"
    ],
    plannedCapabilities: ["Read account insights", "Publish images, carousels and reels", "Read and reply to comments"]
  },
  {
    key: "tiktok",
    label: "TikTok",
    cycle: 3,
    summary: "Upload videos and read basic account data through TikTok's Content Posting and Display APIs.",
    needs: ["A TikTok developer app", "Content Posting API approval (unaudited apps can only post privately)", "OAuth authorization of your TikTok account"],
    plannedCapabilities: ["Upload and publish videos", "Check publish status", "Read profile and video stats"]
  },
  {
    key: "x",
    label: "X (Twitter)",
    cycle: 3,
    summary: "Post, read mentions and reply through the X API v2 with OAuth 2.0.",
    needs: ["An X developer project and app", "An API access tier that includes posting and reading (paid tiers)", "OAuth 2.0 authorization of your X account"],
    plannedCapabilities: ["Publish posts and threads", "Read mentions and replies", "Reply when approved"]
  },
  {
    key: "website_analytics",
    label: "Website analytics",
    cycle: 4,
    summary: "Traffic, referrals and conversions from Google Analytics 4 or Plausible.",
    needs: ["GA4: a Google Cloud project with the Analytics Data API and OAuth consent", "or Plausible: an API key for your site"],
    plannedCapabilities: ["Sessions and visitors", "Referrals and UTM campaigns", "Conversions"]
  },
  {
    key: "github",
    label: "GitHub repository",
    cycle: 4,
    summary: "Let the AI read your site's code, propose changes on a branch and open pull requests for review.",
    needs: ["A GitHub App installed on the website repository"],
    plannedCapabilities: ["Read files", "Create branches and commits", "Open pull requests with diffs"]
  },
  {
    key: "deployment",
    label: "Deployment (Vercel)",
    cycle: 4,
    summary: "Preview deployments for proposed changes; production deploys only after your approval.",
    needs: ["A Vercel access token scoped to the project"],
    plannedCapabilities: ["Create preview deployments", "Read build logs", "Promote to production (approval required)"]
  },
  {
    key: "image_gen",
    label: "Image generation",
    cycle: 2,
    summary: "Generate and edit marketing images; outputs are saved as versioned assets.",
    needs: ["An API key for a supported image model provider"],
    plannedCapabilities: ["Generate images", "Edit and create variations", "Background removal where supported"]
  },
  {
    key: "video_gen",
    label: "Video generation",
    cycle: 2,
    summary: "Generate short clips and assemble them with FFmpeg (subtitles, cuts, formats).",
    needs: ["An API key for a supported video model provider", "FFmpeg on the server"],
    plannedCapabilities: ["Generate clips", "Add subtitles", "Assemble and export videos"]
  },
  {
    key: "news",
    label: "News & trends sources",
    cycle: 5,
    summary: "Real current events for Discover: RSS feeds, Hacker News, GitHub and a news API, always with source links.",
    needs: ["RSS feeds and Hacker News need no key", "Optional: a news API key for broader coverage"],
    plannedCapabilities: ["Daily briefing", "Project-specific opportunities", "Source-linked summaries"]
  }
];

export const integrationInfo = (key: string) => INTEGRATIONS.find((i) => i.key === key);
