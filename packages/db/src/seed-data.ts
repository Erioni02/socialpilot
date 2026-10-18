import type { PrismaClient } from "@prisma/client";

/** Real public sources. Each one is fetched live; failures are recorded on the source row, never faked. */
export const DEFAULT_DISCOVER_SOURCES: { type: string; name: string; url?: string; category: string }[] = [
  { type: "hn", name: "Hacker News — Top", url: "https://hacker-news.firebaseio.com/v0/topstories.json", category: "tech" },
  { type: "hn", name: "Hacker News — Show HN", url: "https://hacker-news.firebaseio.com/v0/showstories.json", category: "startup" },
  { type: "github", name: "GitHub — new trending repositories", url: "https://api.github.com/search/repositories", category: "devtools" },
  { type: "rss", name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "startup" },
  { type: "rss", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "tech" },
  { type: "rss", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "tech" },
  { type: "rss", name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", category: "ai" },
  { type: "rss", name: "OpenAI News", url: "https://openai.com/news/rss.xml", category: "ai" },
  { type: "rss", name: "Google AI Blog", url: "https://blog.google/technology/ai/rss/", category: "ai" },
  { type: "rss", name: "GitHub Blog", url: "https://github.blog/feed/", category: "devtools" },
  { type: "rss", name: "Product Hunt", url: "https://www.producthunt.com/feed", category: "startup" },
  { type: "rss", name: "Simon Willison", url: "https://simonwillison.net/atom/everything/", category: "ai" },
  { type: "newsapi", name: "NewsAPI — Technology headlines", category: "business" },
  { type: "producthunt", name: "Product Hunt API — Today", category: "startup" },
];

export async function seedDiscoverSources(prisma: PrismaClient): Promise<void> {
  for (const s of DEFAULT_DISCOVER_SOURCES) {
    await prisma.discoverSource.upsert({
      where: { type_name: { type: s.type, name: s.name } },
      update: {},
      create: s,
    });
  }
}
