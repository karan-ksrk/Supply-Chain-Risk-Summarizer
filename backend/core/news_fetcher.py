"""
core/news_fetcher.py
--------------------
Fetches latest logistics/supply chain news.
Priority:
  1. NewsAPI (if NEWS_API_KEY is set)
  2. Google News RSS (free fallback, no key needed)
"""

import os
import feedparser
import requests
from dotenv import load_dotenv

load_dotenv()

LOGISTICS_KEYWORDS = [
    "port strike", "shipping delay", "supply chain", "cargo disruption",
    "Red Sea", "Suez Canal", "Panama Canal", "freight", "vessel delay",
    "port congestion", "logistics risk", "trade disruption", "typhoon shipping",
    "customs delay", "dock workers", "container shortage"
]


def fetch_news(max_articles: int = 20) -> list[dict]:
    """
    Returns a list of news articles as dicts:
    { title, description, source, published_at, url }
    """
    api_key = os.getenv("NEWS_API_KEY", "")
    if api_key:
        print("📡 Fetching news via NewsAPI...")
        articles = _fetch_from_newsapi(api_key, max_articles)
    else:
        print("📡 Fetching news via Google News RSS (no API key found)...")
        articles = _fetch_from_rss(max_articles)

    print(f"   ✓ {len(articles)} articles fetched\n")
    return articles


# ── NewsAPI ──────────────────────────────────────────────────

def _fetch_from_newsapi(api_key: str, max_articles: int) -> list[dict]:
    query = " OR ".join([
        "port strike", "shipping delay", "supply chain disruption",
        "Red Sea shipping", "cargo delay", "freight disruption"
    ])

    resp = requests.get(
        "https://newsapi.org/v2/everything",
        params={
            "q": query,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": max_articles,
            "apiKey": api_key,
        },
        timeout=10,
    )
    resp.raise_for_status()
    raw = resp.json().get("articles", [])

    return [
        {
            "title": a.get("title", ""),
            "description": a.get("description", ""),
            "source": a.get("source", {}).get("name", "Unknown"),
            "published_at": a.get("publishedAt", ""),
            "url": a.get("url", ""),
        }
        for a in raw
        if a.get("title")
    ]


# ── Google News RSS (free fallback) ─────────────────────────

def _fetch_from_rss(max_articles: int) -> list[dict]:
    articles = []

    rss_queries = [
        "port+strike+shipping",
        "supply+chain+disruption",
        "Red+Sea+shipping",
        "cargo+delay+logistics",
    ]

    for query in rss_queries:
        url = f"https://news.google.com/rss/search?q={query}&hl=en&gl=US&ceid=US:en"
        feed = feedparser.parse(url)

        for entry in feed.entries[:5]:
            articles.append({
                "title": entry.get("title", ""),
                "description": entry.get("summary", ""),
                "source": "Google News",
                "published_at": entry.get("published", ""),
                "url": entry.get("link", ""),
            })

        if len(articles) >= max_articles:
            break

    # Deduplicate by title
    seen = set()
    unique = []
    for a in articles:
        if a["title"] not in seen:
            seen.add(a["title"])
            unique.append(a)

    return unique[:max_articles]
