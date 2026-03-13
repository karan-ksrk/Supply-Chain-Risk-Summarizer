"""
core/news_fetcher.py
--------------------
Fetches latest logistics/supply chain news.
Priority:
  1. NewsAPI (if NEWS_API_KEY is set)
  2. Google News RSS (free fallback, no key needed)
"""

import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import feedparser
import requests
from dotenv import load_dotenv

load_dotenv()

PLACEHOLDER_NEWS_API_KEYS = {
    "",
    "your_newsapi_key_here",
    "changeme",
    "replace_me",
}

DEFAULT_RSS_QUERIES = [
    "port strike shipping",
    "port congestion freight",
    "supply chain disruption",
    "cargo delay logistics",
    "customs delay imports",
    "rail freight disruption",
    "airport cargo delay",
    "vessel diversion shipping",
    "carrier shipping delay",
    "\"Red Sea\" shipping",
    "\"Suez Canal\" disruption",
    "\"Panama Canal\" shipping",
    "typhoon shipping disruption",
    "dock workers strike",
]

DISRUPTION_KEYWORDS = {
    "strike": 4,
    "congestion": 4,
    "delay": 4,
    "delays": 4,
    "disruption": 4,
    "closure": 5,
    "closed": 5,
    "reroute": 5,
    "rerouting": 5,
    "diversion": 5,
    "attack": 5,
    "attacks": 5,
    "sanction": 4,
    "sanctions": 4,
    "customs": 4,
    "weather": 3,
    "storm": 3,
    "typhoon": 4,
    "cyclone": 4,
    "shortage": 3,
}

TRUSTED_SOURCES = {
    "freightwaves": 3,
    "lloyd's list": 3,
    "journal of commerce": 3,
    "joc": 3,
    "air cargo news": 2,
    "the loadstar": 2,
    "splash247": 2,
    "seatrade maritime": 2,
}

ENTITY_WEIGHTS = {
    "ports": 8,
    "carriers": 7,
    "routes": 6,
    "countries": 4,
    "cities": 3,
}


def fetch_news(max_articles: int = 20, shipments: list[dict] | None = None) -> list[dict]:
    """
    Returns a list of news articles as dicts:
    { title, description, source, published_at, url }
    """
    api_key = _get_news_api_key()

    if api_key:
        try:
            print("📡 Fetching news via NewsAPI...")
            articles = _fetch_from_newsapi(api_key, max_articles, shipments)
            print(f"   ✓ {len(articles)} articles fetched\n")
            return articles
        except requests.RequestException as exc:
            print(f"   ! NewsAPI fetch failed: {exc}")
            print("   ↪ Falling back to Google News RSS...")
    else:
        print("📡 Fetching news via Google News RSS (no valid NewsAPI key found)...")

    articles = _fetch_from_rss(max_articles, shipments)

    print(f"   ✓ {len(articles)} articles fetched\n")
    return articles


# ── NewsAPI ──────────────────────────────────────────────────

def _fetch_from_newsapi(api_key: str, max_articles: int, shipments: list[dict] | None = None) -> list[dict]:
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

    articles = [
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
    return _rank_articles(articles, shipments, max_articles)


# ── Google News RSS (free fallback) ─────────────────────────

def _get_news_api_key() -> str | None:
    api_key = os.getenv("NEWS_API_KEY", "").strip()
    if api_key.lower() in PLACEHOLDER_NEWS_API_KEYS:
        return None
    return api_key or None


def _fetch_from_rss(max_articles: int, shipments: list[dict] | None = None) -> list[dict]:
    articles = []
    queries = _build_rss_queries(shipments)
    per_query_limit = 4

    print(f"   ↪ Running {len(queries)} RSS searches")

    for query in queries:
        url = f"https://news.google.com/rss/search?q={requests.utils.quote(query)}&hl=en&gl=US&ceid=US:en"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        feed = feedparser.parse(resp.content)

        for entry in feed.entries[:per_query_limit]:
            articles.append({
                "title": entry.get("title", ""),
                "description": entry.get("summary", ""),
                "source": _extract_rss_source_name(entry),
                "published_at": entry.get("published", ""),
                "url": entry.get("link", ""),
                "search_query": query,
            })

    if not articles:
        raise RuntimeError("No articles fetched from Google News RSS.")

    unique = _dedupe_articles(articles)
    return _rank_articles(unique, shipments, max_articles)


def _build_rss_queries(shipments: list[dict] | None) -> list[str]:
    queries = list(DEFAULT_RSS_QUERIES)
    if not shipments:
        return queries

    entities = _collect_shipment_entities(shipments)
    dynamic_queries = []

    for port in entities["ports"][:4]:
        dynamic_queries.append(f"\"{port}\" congestion")
        dynamic_queries.append(f"\"{port}\" strike")

    for carrier in entities["carriers"][:3]:
        dynamic_queries.append(f"\"{carrier}\" shipping delay")

    for route in entities["routes"][:3]:
        dynamic_queries.append(f"\"{route}\" shipping disruption")

    for country in entities["countries"][:2]:
        dynamic_queries.append(f"\"{country}\" customs delay")

    for city in entities["cities"][:2]:
        dynamic_queries.append(f"\"{city}\" cargo delay")

    return _unique_preserve_order(queries + dynamic_queries)[:24]


def _collect_shipment_entities(shipments: list[dict]) -> dict[str, list[str]]:
    return {
        "ports": _top_terms(
            shipments,
            ["origin_port", "dest_port"],
            minimum_words=2,
        ),
        "carriers": _top_terms(shipments, ["carrier"]),
        "routes": _top_terms(shipments, ["route"]),
        "countries": _top_terms(shipments, ["origin_country", "dest_country"]),
        "cities": _top_terms(shipments, ["origin_city", "dest_city"]),
    }


def _top_terms(shipments: list[dict], fields: list[str], minimum_words: int = 1) -> list[str]:
    counts: dict[str, int] = {}
    for shipment in shipments:
        for field in fields:
            value = str(shipment.get(field, "")).strip()
            if not value:
                continue
            if len(value.split()) < minimum_words:
                continue
            counts[value] = counts.get(value, 0) + 1

    return [
        term for term, _ in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]


def _rank_articles(articles: list[dict], shipments: list[dict] | None, max_articles: int) -> list[dict]:
    entities = _collect_shipment_entities(shipments) if shipments else None
    ranked = []
    for article in articles:
        score = _score_article(article, entities)
        article_copy = article.copy()
        article_copy["relevance_score"] = score
        ranked.append(article_copy)

    ranked.sort(
        key=lambda article: (
            article.get("relevance_score", 0),
            _published_timestamp(article.get("published_at", "")),
        ),
        reverse=True,
    )
    return ranked[:max_articles]


def _score_article(article: dict, entities: dict[str, list[str]] | None) -> int:
    title = _normalize_text(article.get("title", ""))
    description = _normalize_text(article.get("description", ""))
    combined = f"{title} {description}".strip()
    score = 0

    for keyword, weight in DISRUPTION_KEYWORDS.items():
        if keyword in title:
            score += weight + 1
        elif keyword in description:
            score += weight

    if entities:
        for entity_type, terms in entities.items():
            weight = ENTITY_WEIGHTS[entity_type]
            for term in terms:
                normalized_term = _normalize_text(term)
                if not normalized_term:
                    continue
                if normalized_term in title:
                    score += weight + 2
                elif normalized_term in combined:
                    score += weight

    source = article.get("source", "").strip().lower()
    score += TRUSTED_SOURCES.get(source, 0)
    score += _recency_boost(article.get("published_at", ""))
    return score


def _dedupe_articles(articles: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for article in articles:
        key = (
            _normalize_url(article.get("url", "")),
            _normalize_text(article.get("title", "")),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(article)
    return unique


def _extract_rss_source_name(entry) -> str:
    source = entry.get("source")
    if isinstance(source, dict):
        return source.get("title", "Google News")
    return "Google News"


def _recency_boost(published_at: str) -> int:
    timestamp = _published_timestamp(published_at)
    if not timestamp:
        return 0

    age_hours = max(0, (datetime.now(timezone.utc).timestamp() - timestamp) / 3600)
    if age_hours <= 24:
        return 4
    if age_hours <= 72:
        return 3
    if age_hours <= 168:
        return 2
    return 1


def _published_timestamp(value: str) -> float:
    if not value:
        return 0

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        pass

    try:
        return parsedate_to_datetime(value).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0


def _normalize_text(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", value.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalize_url(url: str) -> str:
    return url.strip().lower().rstrip("/")


def _unique_preserve_order(items: list[str]) -> list[str]:
    seen = set()
    unique = []
    for item in items:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique
