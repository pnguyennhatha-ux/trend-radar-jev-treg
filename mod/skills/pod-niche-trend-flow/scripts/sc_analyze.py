#!/usr/bin/env python3
"""Normalize ScrapeCreators raw JSON dumps and score each platform.

Heat score (0-100), same formula used on the funny-dog POD pilot:

    heat = 100 * (0.35 * Recency + 0.35 * Engagement + 0.30 * Relevance)
           / (sum of weights for components that have data)

Missing components are dropped and the remaining weights are renormalized.
Pinterest and Meta ad-library results often have no engagement fields, so
their heat is Recency + Relevance only.

    Recency     = 0.5 * share(age <= 30 days) + 0.5 * share(age <= 90 days)
    Engagement  = log10(1 + median_metric) / log10(1 + cap)
                  default caps: views=100000, reddit likes=1000
    Relevance   = share of posts matching BOTH --product-regex and --niche-regex

The script auto-detects TikTok, Instagram Reels, YouTube, Pinterest, Reddit,
Meta ads, and Threads payloads by JSON shape. Error payloads (for example a
400 from /v1/tiktok/hashtags/popular) are skipped. No API keys are read or
printed; this is an offline scorer.

Example:

    python sc_analyze.py \\
      --input-dir raw/sc \\
      --output-dir out \\
      --niche-regex 'dog|pup|doggo|paw|woof' \\
      --now 2026-11-25T00:00:00+00:00
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import json
import math
import re
import statistics
import sys
from pathlib import Path
from typing import Any

DEFAULT_PRODUCT_RE = (
    r"shirt|tee\b|t-shirt|tshirt|hoodie|sweatshirt|crewneck|"
    r"sweater|pullover|apparel|sudadera"
)

DEFAULT_MOTIFS = {
    "holiday_gift": (
        r"christmas|xmas|halloween|thanksgiving|santa|holiday|"
        r"ugly sweater|black friday|\bgifts?\b|navidad|valentine"
    ),
    "custom_portrait": r"custom|personali[sz]ed|pet portrait|your (dog|pet)|photo",
    "humor_sarcasm": r"funny|sarcas|humor|\blol\b|meme|joke|hilarious",
    "shop_signal": (
        r"tiktokshop|tiktok shop|link in bio|shop now|"
        r"tiktokmademebuyit|% ?off|sale\b|\$\d"
    ),
}

# Sources whose dates are biased (e.g. a this-month filter) are kept in the
# post table but left out of the recency share unless --include-all-recency.
RECENCY_BIAS_MARKERS = ("_month", "this-month", "_week", "this-week", "_today")

WEIGHT_RECENCY = 0.35
WEIGHT_ENGAGEMENT = 0.35
WEIGHT_RELEVANCE = 0.30

CAPS = {
    "TikTok": ("views", 100_000),
    "TikTok trending": ("views", 100_000),
    "Instagram": ("views", 100_000),
    "YouTube": ("views", 100_000),
    "Reddit": ("likes", 1_000),
    "Threads": ("likes", 1_000),
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input-dir", required=True, type=Path, help="Folder of raw ScrapeCreators JSON files")
    p.add_argument("--output-dir", required=True, type=Path, help="Folder for sc_posts.csv and sc_platform_summary.json")
    p.add_argument(
        "--niche-regex",
        required=True,
        help="Case-insensitive regex that must match for a post to count as on-niche "
        "(combine with --product-regex). Example: 'dog|pup|doggo|paw'",
    )
    p.add_argument(
        "--product-regex",
        default=DEFAULT_PRODUCT_RE,
        help="Case-insensitive product regex (default: t-shirt/hoodie terms)",
    )
    p.add_argument("--now", default=None, help="ISO-8601 UTC timestamp for age math (default: current UTC)")
    p.add_argument("--motifs-json", type=Path, default=None, help="Optional JSON object of {name: regex} motif detectors")
    p.add_argument(
        "--exclude-advertisers",
        default="",
        help="Comma-separated Meta page names to mark not-relevant (off-niche advertisers)",
    )
    p.add_argument(
        "--include-all-recency",
        action="store_true",
        help="Include date-filtered sources (filename contains _month/_week) in recency",
    )
    p.add_argument("--views-cap", type=int, default=100_000, help="Log cap for view-based engagement")
    p.add_argument("--likes-cap", type=int, default=1_000, help="Log cap for like/upvote-based engagement")
    return p.parse_args()


def parse_now(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime.now(dt.timezone.utc)
    text = value.replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def to_int(value: Any) -> int | None:
    if value is None or value is False:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def from_timestamp(value: Any) -> dt.datetime | None:
    if value is None or value == "":
        return None
    try:
        return dt.datetime.fromtimestamp(int(float(value)), dt.timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def from_iso(value: Any) -> dt.datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def from_rfc2822(value: Any) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.strptime(str(value), "%a, %d %b %Y %H:%M:%S %z").astimezone(dt.timezone.utc)
    except ValueError:
        return None


def load_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"skip {path.name}: cannot read JSON ({exc})", file=sys.stderr)
        return None


def is_error_payload(obj: Any) -> bool:
    if not isinstance(obj, dict):
        return True
    if obj.get("error") or obj.get("errorStatus"):
        return True
    return False


def detect_kind(obj: dict) -> str | None:
    if "searchResults" in obj and any(
        isinstance(x, dict) and ("ad_archive_id" in x or "snapshot" in x)
        for x in (obj.get("searchResults") or [])[:3]
    ):
        return "meta_ads"
    if "search_item_list" in obj or (
        "aweme_list" in obj
        and any(isinstance(x, dict) and "aweme_id" in x for x in (obj.get("aweme_list") or [])[:3])
    ):
        return "tiktok"
    if "reels" in obj:
        return "instagram"
    if any(k in obj for k in ("shorts", "videos")) and any(
        isinstance(x, dict) and (x.get("viewCountInt") is not None or x.get("publishedTime") or x.get("type") in {"shorts", "video", "videos"})
        for k in ("shorts", "videos")
        for x in (obj.get(k) or [])[:3]
    ):
        return "youtube"
    if "pins" in obj:
        return "pinterest"
    posts = obj.get("posts") or []
    sample = next((x for x in posts if isinstance(x, dict)), None)
    if sample and ("subreddit" in sample or "created_utc" in sample or "ups" in sample):
        return "reddit"
    if "posts" in obj:
        # Threads search often returns posts: [] — still label it so empty platforms show up.
        return "threads"
    return None


def tiktok_url(item: dict) -> str:
    if item.get("url"):
        return str(item["url"])
    handle = (item.get("author") or {}).get("unique_id") or ""
    return f"https://www.tiktok.com/@{handle}/video/{item.get('aweme_id', '')}"


def reddit_url(item: dict) -> str:
    url = item.get("url") or ""
    if "reddit.com" in url:
        return url
    permalink = item.get("permalink") or ""
    if permalink:
        if permalink.startswith("http"):
            return permalink
        return "https://www.reddit.com" + permalink
    return url


def add_row(
    rows: list[dict],
    *,
    platform: str,
    source: str,
    item_id: Any,
    url: str,
    text: str,
    views: Any = None,
    likes: Any = None,
    comments: Any = None,
    shares: Any = None,
    when: dt.datetime | None = None,
    extra: str = "",
    now: dt.datetime,
) -> None:
    views_i, likes_i, comments_i, shares_i = map(to_int, (views, likes, comments, shares))
    age = (now - when).days if when else None
    rows.append(
        {
            "platform": platform,
            "source": source,
            "id": str(item_id),
            "url": url or "",
            "text": (text or "").strip(),
            "views": views_i,
            "likes": likes_i,
            "comments": comments_i,
            "shares": shares_i,
            "date": when.strftime("%Y-%m-%d") if when else "",
            "age_days": age,
            "extra": extra or "",
        }
    )


def parse_file(path: Path, obj: dict, now: dt.datetime, rows: list[dict]) -> str | None:
    kind = detect_kind(obj)
    if kind is None:
        return None
    source = path.stem
    if kind == "tiktok":
        items = obj.get("search_item_list") or obj.get("aweme_list") or []
        platform = "TikTok trending" if "trending" in source.lower() else "TikTok"
        for item in items:
            if not isinstance(item, dict) or not item.get("aweme_id"):
                continue
            stats = item.get("statistics") or {}
            author = item.get("author") or {}
            shop = "shop" if item.get("shop_product_url") or item.get("is_eligible_for_commission") else ""
            add_row(
                rows,
                platform=platform,
                source=source,
                item_id=item["aweme_id"],
                url=tiktok_url(item),
                text=item.get("desc") or "",
                views=stats.get("play_count"),
                likes=stats.get("digg_count"),
                comments=stats.get("comment_count"),
                shares=stats.get("share_count"),
                when=from_timestamp(item.get("create_time")),
                extra=shop,
                now=now,
            )
        return kind
    if kind == "instagram":
        for item in obj.get("reels") or []:
            if not isinstance(item, dict):
                continue
            add_row(
                rows,
                platform="Instagram",
                source=source,
                item_id=item.get("shortcode") or item.get("id"),
                url=item.get("url") or "",
                text=item.get("caption") or "",
                views=item.get("video_view_count"),
                likes=item.get("like_count"),
                comments=item.get("comment_count"),
                when=from_iso(item.get("taken_at")),
                now=now,
            )
        return kind
    if kind == "youtube":
        for key in ("shorts", "videos"):
            for item in obj.get(key) or []:
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                add_row(
                    rows,
                    platform="YouTube",
                    source=source,
                    item_id=item["id"],
                    url=item.get("url") or "",
                    text=item.get("title") or "",
                    views=item.get("viewCountInt"),
                    when=from_iso(item.get("publishedTime")),
                    extra=key,
                    now=now,
                )
        return kind
    if kind == "pinterest":
        for item in obj.get("pins") or []:
            if not isinstance(item, dict):
                continue
            text = " ".join(filter(None, [item.get("title") or "", item.get("description") or ""]))
            add_row(
                rows,
                platform="Pinterest",
                source=source,
                item_id=item.get("id"),
                url=item.get("url") or "",
                text=text,
                when=from_rfc2822(item.get("created_at")) or from_iso(item.get("created_at")),
                now=now,
            )
        return kind
    if kind == "reddit":
        for item in obj.get("posts") or []:
            if not isinstance(item, dict):
                continue
            add_row(
                rows,
                platform="Reddit",
                source=source,
                item_id=item.get("id"),
                url=reddit_url(item),
                text=item.get("title") or "",
                likes=item.get("score") if item.get("score") is not None else item.get("ups"),
                comments=item.get("num_comments"),
                when=from_timestamp(item.get("created_utc") or item.get("created")),
                extra=("r/" + item["subreddit"]) if item.get("subreddit") else "",
                now=now,
            )
        return kind
    if kind == "meta_ads":
        for item in obj.get("searchResults") or []:
            if not isinstance(item, dict):
                continue
            snapshot = item.get("snapshot") or {}
            body = ((snapshot.get("body") or {}) if isinstance(snapshot.get("body"), dict) else {}).get("text") or ""
            if not body and isinstance(snapshot.get("body"), str):
                body = snapshot.get("body") or ""
            cards = snapshot.get("cards") or []
            card_text = " ".join(
                f"{c.get('title') or ''} {c.get('body') or ''}" for c in cards[:2] if isinstance(c, dict)
            )
            add_row(
                rows,
                platform="Meta Ads",
                source=source,
                item_id=item.get("ad_archive_id") or item.get("id"),
                url=item.get("url") or "",
                text=" | ".join(t for t in (body, card_text) if t.strip()),
                when=from_timestamp(item.get("start_date")),
                extra=item.get("page_name") or "",
                now=now,
            )
        return kind
    if kind == "threads":
        for item in obj.get("posts") or []:
            if not isinstance(item, dict):
                continue
            text = item.get("text") or item.get("caption") or item.get("body") or ""
            user = item.get("user") if isinstance(item.get("user"), dict) else {}
            add_row(
                rows,
                platform="Threads",
                source=source,
                item_id=item.get("id") or item.get("pk") or item.get("code"),
                url=item.get("url") or item.get("permalink") or "",
                text=text,
                likes=item.get("like_count") or item.get("likes"),
                comments=item.get("comment_count") or item.get("replies"),
                when=from_iso(item.get("taken_at") or item.get("timestamp")) or from_timestamp(item.get("taken_at")),
                extra=item.get("username") or user.get("username") or "",
                now=now,
            )
        return kind
    return None


def recency_excluded(source: str, include_all: bool) -> bool:
    if include_all:
        return False
    return any(marker in source for marker in RECENCY_BIAS_MARKERS)


def capnorm(value: float | None, cap: int) -> float | None:
    if value is None:
        return None
    return min(1.0, math.log10(1 + value) / math.log10(1 + cap))


def median(values: list[float]) -> float | None:
    clean = [v for v in values if v is not None]
    return statistics.median(clean) if clean else None


def score_platforms(
    rows: list[dict],
    *,
    include_all_recency: bool,
    views_cap: int,
    likes_cap: int,
) -> list[dict]:
    platforms = []
    seen = []
    for row in rows:
        if row["platform"] not in seen:
            seen.append(row["platform"])
    summaries = []
    for platform in seen:
        all_rows = [r for r in rows if r["platform"] == platform]
        relevant = [r for r in all_rows if r["relevant"]]
        dated = [
            r
            for r in relevant
            if r["age_days"] is not None and not recency_excluded(r["source"], include_all_recency)
        ]
        share_30 = (sum(r["age_days"] <= 30 for r in dated) / len(dated)) if dated else None
        share_90 = (sum(r["age_days"] <= 90 for r in dated) / len(dated)) if dated else None
        recency = (0.5 * share_30 + 0.5 * share_90) if share_30 is not None else None

        default_metric, default_cap = CAPS.get(platform, (None, None))
        if default_metric == "views":
            cap = views_cap
        elif default_metric == "likes":
            cap = likes_cap
        else:
            cap = None
        metric = default_metric
        values = [r[metric] for r in relevant if metric and r[metric] is not None] if metric else []
        med = median(values)
        top = max(values) if values else None
        engagement = capnorm(med, cap) if med is not None and cap else None
        relevance = (len(relevant) / len(all_rows)) if all_rows else None

        components = [
            (WEIGHT_RECENCY, recency),
            (WEIGHT_ENGAGEMENT, engagement),
            (WEIGHT_RELEVANCE, relevance),
        ]
        available = [(w, v) for w, v in components if v is not None]
        heat = round(100 * sum(w * v for w, v in available) / sum(w for w, _ in available)) if available else None

        motifs = collections.Counter(m for r in relevant for m in r["motifs"].split(";") if m)
        hashtags = collections.Counter(h for r in relevant for h in r["hashtags"].split() if h)
        if metric:
            outliers = sorted([r for r in relevant if r[metric] is not None], key=lambda r: -r[metric])[:3]
        else:
            outliers = sorted(relevant, key=lambda r: r["age_days"] if r["age_days"] is not None else 10**9)[:3]

        summaries.append(
            {
                "platform": platform,
                "n_all": len(all_rows),
                "n_relevant": len(relevant),
                "advertisers": len({r["extra"] for r in relevant if r["extra"]}) if platform == "Meta Ads" else None,
                "n_dated": len(dated),
                "metric": metric or "none (API does not return engagement)",
                "median": med,
                "top": top,
                "median_er": median([r["er"] for r in relevant]),
                "share_30d": None if share_30 is None else round(share_30, 3),
                "share_90d": None if share_90 is None else round(share_90, 3),
                "recency": None if recency is None else round(recency, 3),
                "engagement": None if engagement is None else round(engagement, 3),
                "relevance": None if relevance is None else round(relevance, 3),
                "heat": heat,
                "partial": len(available) < 3,
                "motifs": motifs.most_common(8),
                "hashtags": hashtags.most_common(10),
                "shop_share": (
                    round(
                        sum("shop_signal" in r["motifs"] or r["extra"] == "shop" for r in relevant) / len(relevant),
                        3,
                    )
                    if relevant
                    else None
                ),
                "outliers": [
                    {
                        "url": r["url"],
                        "metric": r[metric] if metric else None,
                        "date": r["date"],
                        "hook": r["text"].split("\n")[0][:160],
                        "x_median": round(r[metric] / med, 1) if metric and med else None,
                        "extra": r["extra"],
                    }
                    for r in outliers
                ],
            }
        )
        platforms.append(platform)
    return summaries


def main() -> int:
    args = parse_args()
    input_dir: Path = args.input_dir
    output_dir: Path = args.output_dir
    if not input_dir.is_dir():
        print(f"input dir not found: {input_dir}", file=sys.stderr)
        return 2
    now = parse_now(args.now)
    niche_re = re.compile(args.niche_regex, re.I)
    product_re = re.compile(args.product_regex, re.I)
    motifs = dict(DEFAULT_MOTIFS)
    if args.motifs_json:
        extra = json.loads(args.motifs_json.read_text(encoding="utf-8"))
        if not isinstance(extra, dict):
            print("motifs JSON must be an object of {name: regex}", file=sys.stderr)
            return 2
        motifs.update({str(k): str(v) for k, v in extra.items()})
    motif_res = {name: re.compile(pat, re.I) for name, pat in motifs.items()}
    excluded_advertisers = {name.strip() for name in args.exclude_advertisers.split(",") if name.strip()}

    rows: list[dict] = []
    skipped = []
    for path in sorted(input_dir.glob("*.json")):
        obj = load_json(path)
        if obj is None:
            skipped.append(path.name)
            continue
        if is_error_payload(obj):
            msg = obj.get("message") or obj.get("error") or obj.get("errorStatus") or "error payload"
            print(f"skip {path.name}: {msg}", file=sys.stderr)
            skipped.append(path.name)
            continue
        kind = parse_file(path, obj, now, rows)
        if kind is None:
            print(f"skip {path.name}: unrecognized JSON shape", file=sys.stderr)
            skipped.append(path.name)

    # Dedupe by platform + id, merge sources.
    deduped: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (row["platform"], row["id"])
        if key in deduped:
            existing = deduped[key]["source"]
            if row["source"] not in existing.split("|"):
                deduped[key]["source"] = existing + "|" + row["source"]
        else:
            deduped[key] = row
    rows = list(deduped.values())

    for row in rows:
        text = row["text"].lower()
        row["motifs"] = ";".join(name for name, pat in motif_res.items() if pat.search(text))
        product = 1 if product_re.search(text) else 0
        niche = 1 if niche_re.search(text) else 0
        row["product"] = product
        row["niche"] = niche
        row["relevant"] = product * niche
        if row["platform"] == "Meta Ads" and row["extra"] in excluded_advertisers:
            row["relevant"] = 0
        row["hashtags"] = " ".join(sorted(set(h.lower() for h in re.findall(r"#(\w+)", row["text"]))))
        if row["views"] and row["likes"] is not None:
            row["er"] = round(
                ((row["likes"] or 0) + (row["comments"] or 0) + (row["shares"] or 0)) / row["views"],
                4,
            )
        else:
            row["er"] = None

    output_dir.mkdir(parents=True, exist_ok=True)
    posts_path = output_dir / "sc_posts.csv"
    if rows:
        fieldnames = [
            "platform",
            "source",
            "id",
            "url",
            "text",
            "views",
            "likes",
            "comments",
            "shares",
            "date",
            "age_days",
            "extra",
            "motifs",
            "product",
            "niche",
            "relevant",
            "hashtags",
            "er",
        ]
        with posts_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    else:
        posts_path.write_text("", encoding="utf-8")

    summaries = score_platforms(
        rows,
        include_all_recency=args.include_all_recency,
        views_cap=args.views_cap,
        likes_cap=args.likes_cap,
    )
    summary_path = output_dir / "sc_platform_summary.json"
    summary_path.write_text(json.dumps(summaries, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")

    print(f"posts={len(rows)} platforms={len(summaries)} skipped={len(skipped)}")
    print("platform\theat\tn_rel/n_all\tmedian\ttop\t<=30d\t<=90d\tpartial")
    for item in summaries:
        print(
            f"{item['platform']}\t{item['heat']}\t{item['n_relevant']}/{item['n_all']}\t"
            f"{item['median']}\t{item['top']}\t{item['share_30d']}\t{item['share_90d']}\t{item['partial']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
