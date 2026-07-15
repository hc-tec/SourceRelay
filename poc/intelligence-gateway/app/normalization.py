from __future__ import annotations

import hashlib
import json
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .models import SearchItem


TRACKING_QUERY_KEYS = {
    "spm_id_from",
    "from_source",
    "from_spmid",
    "share_source",
    "share_medium",
    "share_plat",
    "share_session_id",
    "share_tag",
    "timestamp",
    "unique_k",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
    "xsec_source",
    "xsec_token",
}


def canonicalize_url(url: str) -> str:
    raw = url.strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
    except ValueError:
        return ""
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return ""
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_KEYS and not key.lower().startswith("utm_")
    ]
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))


def is_bilibili_video_url(url: str) -> bool:
    return bool(re.match(r"^https://www\.bilibili\.com/video/", url, flags=re.IGNORECASE))


def is_xiaohongshu_note_url(url: str) -> bool:
    return bool(
        re.match(
            r"^https://www\.xiaohongshu\.com/(?:explore|discovery/item)/",
            url,
            flags=re.IGNORECASE,
        )
    )


def deduplicate_items(items: list[SearchItem]) -> list[SearchItem]:
    seen: set[str] = set()
    result: list[SearchItem] = []
    for item in items:
        url_key = canonicalize_url(item.url)
        fallback = f"{item.title.strip().casefold()}|{item.author.strip().casefold()}"
        key = url_key or fallback
        if not key or key in seen:
            continue
        seen.add(key)
        if url_key:
            item.url = url_key
        item.rank = len(result) + 1
        result.append(item)
    return result


def _normalized_identity_text(value: str) -> str:
    return "".join(character.casefold() for character in value if character.isalnum())


def item_identity(item: SearchItem) -> tuple[str, str, str]:
    canonical_url = canonicalize_url(item.url)
    if canonical_url:
        identity_material = canonical_url
    else:
        title = _normalized_identity_text(item.title)
        author = _normalized_identity_text(item.author)
        identity_material = f"{title}|{author}"
    identity_key = hashlib.sha256(
        f"{item.source.value}|{identity_material}".encode("utf-8")
    ).hexdigest()
    document_id = identity_key
    title_material = _normalized_identity_text(item.title)
    cross_source_material = title_material or identity_material
    cross_source_fingerprint = hashlib.sha256(
        cross_source_material.encode("utf-8")
    ).hexdigest()
    return document_id, identity_key, cross_source_fingerprint


def item_content_hash(item: SearchItem) -> str:
    stable_metrics = {
        key: value for key, value in item.metrics.items() if key not in {"score", "engines"}
    }
    material = {
        "title": item.title.strip(),
        "url": canonicalize_url(item.url),
        "author": item.author.strip(),
        "author_url": canonicalize_url(item.author_url),
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "published_text": item.published_text.strip(),
        "snippet": item.snippet.strip(),
        "metrics": stable_metrics,
        "content_type": item.content_type,
        "promoted": item.promoted,
    }
    encoded = json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
