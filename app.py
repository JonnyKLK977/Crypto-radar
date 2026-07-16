"""Crypto Radar - local, dependency-free web server."""

from __future__ import annotations

import json
import html
import csv
import base64
import binascii
import hashlib
import io
import mimetypes
import os
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from email.utils import parsedate_to_datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("CRYPTO_RADAR_DATA_DIR", str(ROOT / "data"))).resolve()
PORTFOLIO_FILE = DATA_DIR / "portfolio.json"
TRANSLATIONS_FILE = DATA_DIR / "news_translations_it.json"
PLAN_FILE = DATA_DIR / "investment_plan.json"
JOURNAL_FILE = DATA_DIR / "decision_journal.json"
TRANSACTIONS_FILE = DATA_DIR / "transactions.json"
COMMUNITY_FILE = DATA_DIR / "community.json"
MARKET_FALLBACK_FILE = ROOT / "market_fallback.json"
COINGECKO = "https://api.coingecko.com/api/v3"
COINMARKETCAP_PUBLIC = "https://pro-api.coinmarketcap.com/public-api"
COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/"
CRIPTOVALUTA_RSS = "https://www.criptovaluta.it/feed/"
ESMA_CASP_CSV = "https://www.esma.europa.eu/sites/default/files/2024-12/CASPS.csv"
ESMA_NCASP_CSV = "https://www.esma.europa.eu/sites/default/files/2024-12/NCASP.csv"
PORT = int(os.environ.get("PORT", os.environ.get("CRYPTO_RADAR_PORT", "8765")))
HOST = os.environ.get("CRYPTO_RADAR_HOST", "127.0.0.1")
DEMO_MODE = os.environ.get("CRYPTO_RADAR_DEMO", "0").strip().lower() in {"1", "true", "yes", "on"}
FORCE_MARKET_FALLBACK = os.environ.get("CRYPTO_RADAR_FORCE_FALLBACK", "0").strip().lower() in {"1", "true", "yes", "on"}

DEFAULT_PORTFOLIO = {
    "currency": "eur",
    "holdings": [],
}

DEFAULT_PLAN = {
    "totalInvestableCapital": 0,
    "monthlyContribution": 100,
    "horizonYears": 5,
    "maxToleratedLoss": 25,
    "maxCryptoAllocation": 20,
    "maxSingleCoin": 30,
    "maxSpeculative": 10,
    "allowLeverage": False,
    "targets": [],
}

_cache: dict[str, tuple[float, object]] = {}
_import_previews: dict[str, dict] = {}
_translation_locks = {language: threading.Lock() for language in ("it", "en", "es")}
_community_lock = threading.Lock()
_community_rate: dict[tuple[str, str], list[float]] = {}
_community_presence: dict[str, float] = {}


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_portfolio() -> dict:
    if not PORTFOLIO_FILE.exists():
        return DEFAULT_PORTFOLIO.copy()
    try:
        data = json.loads(PORTFOLIO_FILE.read_text(encoding="utf-8"))
        if not isinstance(data.get("holdings"), list):
            raise ValueError("holdings non valido")
        return data
    except (OSError, ValueError, json.JSONDecodeError):
        return DEFAULT_PORTFOLIO.copy()


def save_portfolio(payload: dict) -> dict:
    holdings = []
    for item in payload.get("holdings", []):
        coin_id = str(item.get("id", "")).strip()
        symbol = str(item.get("symbol", "")).strip().upper()[:15]
        if not coin_id or not symbol:
            continue
        try:
            amount = max(0.0, float(item.get("amount", 0)))
            avg_cost = max(0.0, float(item.get("avgCost", 0)))
        except (TypeError, ValueError):
            continue
        holdings.append({"id": coin_id, "symbol": symbol, "amount": amount, "avgCost": avg_cost})
    cleaned = {"currency": "eur", "holdings": holdings[:30]}
    DATA_DIR.mkdir(exist_ok=True)
    temp = PORTFOLIO_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(PORTFOLIO_FILE)
    return cleaned


def load_plan() -> dict:
    try:
        data = json.loads(PLAN_FILE.read_text(encoding="utf-8"))
        if not isinstance(data.get("targets"), list):
            raise ValueError("targets non valido")
    except (OSError, ValueError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_PLAN))
    return data


def save_plan(payload: dict) -> dict:
    number_fields = {
        "totalInvestableCapital": (0, 100_000_000),
        "monthlyContribution": (0, 1_000_000),
        "horizonYears": (1, 50),
        "maxToleratedLoss": (0, 100),
        "maxCryptoAllocation": (0, 100),
        "maxSingleCoin": (0, 100),
        "maxSpeculative": (0, 100),
    }
    cleaned: dict[str, object] = {}
    for field, (minimum, maximum) in number_fields.items():
        try:
            value = float(payload.get(field, DEFAULT_PLAN[field]))
        except (TypeError, ValueError):
            value = float(DEFAULT_PLAN[field])
        cleaned[field] = min(maximum, max(minimum, value))
    cleaned["allowLeverage"] = bool(payload.get("allowLeverage", False))
    targets = []
    seen = set()
    for item in payload.get("targets", []):
        coin_id = str(item.get("id", "")).strip()[:100]
        symbol = str(item.get("symbol", "")).strip().upper()[:15]
        if not coin_id or not symbol or coin_id in seen:
            continue
        try:
            target = min(100.0, max(0.0, float(item.get("target", 0))))
        except (TypeError, ValueError):
            target = 0.0
        targets.append({"id": coin_id, "symbol": symbol, "target": target})
        seen.add(coin_id)
    cleaned["targets"] = targets[:30]
    DATA_DIR.mkdir(exist_ok=True)
    temp = PLAN_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(PLAN_FILE)
    return cleaned


def load_journal() -> list[dict]:
    try:
        data = json.loads(JOURNAL_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def write_journal(entries: list[dict]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    temp = JOURNAL_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(JOURNAL_FILE)


def restore_local_backup(payload: dict) -> dict:
    storage = payload.get("storage")
    if not isinstance(storage, dict):
        raise ValueError("Backup Crypto Radar non valido.")
    restored: list[str] = []
    portfolio = storage.get("cryptoRadarPortfolio")
    if isinstance(portfolio, dict):
        save_portfolio(portfolio)
        restored.append("portfolio")
    plan = storage.get("cryptoRadarPlan")
    if isinstance(plan, dict):
        save_plan(plan)
        restored.append("plan")
    journal = storage.get("cryptoRadarDecisionJournal")
    if isinstance(journal, list):
        write_journal([entry for entry in journal if isinstance(entry, dict)][:1000])
        restored.append("journal")
    return {"restored": restored}


def load_transactions() -> list[dict]:
    try:
        data = json.loads(TRANSACTIONS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError, json.JSONDecodeError):
        return []


def write_transactions(entries: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temp = TRANSACTIONS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(TRANSACTIONS_FILE)


def empty_community() -> dict:
    return {
        "profiles": {},
        "messages": [],
        "posts": [],
        "follows": {},
        "strategyFollows": {},
        "reactions": {},
        "messageVotes": {},
        "ratings": {},
        "feedbackVotes": {},
    }


def load_community_unlocked() -> dict:
    try:
        data = json.loads(COMMUNITY_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("community non valida")
    except (OSError, ValueError, json.JSONDecodeError):
        return empty_community()
    result = empty_community()
    for key, expected in (
        ("profiles", dict),
        ("messages", list),
        ("posts", list),
        ("follows", dict),
        ("strategyFollows", dict),
        ("reactions", dict),
        ("messageVotes", dict),
        ("ratings", dict),
        ("feedbackVotes", dict),
    ):
        if isinstance(data.get(key), expected):
            result[key] = data[key]
    return result


def write_community_unlocked(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temp = COMMUNITY_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(COMMUNITY_FILE)


def community_id(value: object, label: str = "profilo") -> str:
    cleaned = str(value or "").strip()[:64]
    if not cleaned or not all(char.isalnum() or char in "-_" for char in cleaned):
        raise ValueError(f"Identificativo {label} non valido.")
    return cleaned


def community_text(value: object, maximum: int, label: str, minimum: int = 0) -> str:
    cleaned = " ".join(str(value or "").strip().split())[:maximum]
    if len(cleaned) < minimum:
        raise ValueError(f"{label}: inserisci almeno {minimum} caratteri.")
    return cleaned


def community_attachment(value: object) -> dict | None:
    if value in (None, "", {}):
        return None
    if not isinstance(value, dict):
        raise ValueError("Allegato immagine non valido.")
    data_url = str(value.get("dataUrl", "")).strip()
    if len(data_url) > 950_000 or "," not in data_url:
        raise ValueError("L'immagine supera il limite consentito.")
    header, encoded = data_url.split(",", 1)
    mime_by_header = {
        "data:image/jpeg;base64": "image/jpeg",
        "data:image/png;base64": "image/png",
        "data:image/webp;base64": "image/webp",
    }
    mime = mime_by_header.get(header.lower())
    if not mime:
        raise ValueError("Sono ammesse solo immagini JPEG, PNG o WebP.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Immagine codificata in modo non valido.") from exc
    if not raw or len(raw) > 700_000:
        raise ValueError("L'immagine deve pesare al massimo 700 KB dopo la compressione.")
    valid_signature = (
        (mime == "image/jpeg" and raw.startswith(b"\xff\xd8\xff"))
        or (mime == "image/png" and raw.startswith(b"\x89PNG\r\n\x1a\n"))
        or (mime == "image/webp" and len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")
    )
    if not valid_signature:
        raise ValueError("Il contenuto non corrisponde al formato immagine dichiarato.")
    width = max(0, min(4096, int(value.get("width", 0) or 0)))
    height = max(0, min(4096, int(value.get("height", 0) or 0)))
    return {
        "dataUrl": f"{header.lower()},{encoded}",
        "name": community_text(value.get("name"), 80, "Nome immagine") or "immagine-community",
        "mime": mime,
        "size": len(raw),
        "width": width,
        "height": height,
    }


def community_vote_snapshot(votes: dict, target_id: str, viewer: str) -> dict:
    bucket = votes.get(target_id, {})
    if not isinstance(bucket, dict):
        bucket = {}
    likes = list(dict.fromkeys(str(item) for item in bucket.get("likes", []) if isinstance(item, str)))
    dislikes = list(dict.fromkeys(str(item) for item in bucket.get("dislikes", []) if isinstance(item, str)))
    return {
        "likeCount": len(likes),
        "dislikeCount": len(dislikes),
        "viewerVote": "like" if viewer in likes else ("dislike" if viewer in dislikes else ""),
    }


def community_rate_allowed(client_ip: str, bucket: str, limit: int, window: int) -> bool:
    now = time.time()
    key = (client_ip, bucket)
    with _community_lock:
        recent = [stamp for stamp in _community_rate.get(key, []) if now - stamp < window]
        if len(recent) >= limit:
            _community_rate[key] = recent
            return False
        recent.append(now)
        _community_rate[key] = recent
    return True


def community_snapshot(viewer_value: object) -> dict:
    viewer = str(viewer_value or "").strip()[:64]
    with _community_lock:
        data = load_community_unlocked()
        if viewer in data["profiles"]:
            _community_presence[viewer] = time.time()
        cutoff = time.time() - 120
        for user_id, last_seen in list(_community_presence.items()):
            if last_seen < cutoff:
                _community_presence.pop(user_id, None)
        follower_counts: dict[str, int] = {}
        for targets in data["follows"].values():
            if not isinstance(targets, list):
                continue
            for target in set(str(item) for item in targets):
                follower_counts[target] = follower_counts.get(target, 0) + 1
        profiles = []
        for profile in data["profiles"].values():
            if isinstance(profile, dict):
                profiles.append({**profile, "followerCount": follower_counts.get(str(profile.get("id", "")), 0)})
        profiles.sort(key=lambda item: (-int(item.get("followerCount", 0)), str(item.get("displayName", "")).lower()))
        messages = []
        for item in [entry for entry in data["messages"] if isinstance(entry, dict)][-120:]:
            message_id = str(item.get("id", ""))
            messages.append({**item, **community_vote_snapshot(data["messageVotes"], message_id, viewer)})
        posts = []
        for item in sorted(
            [entry for entry in data["posts"] if isinstance(entry, dict)],
            key=lambda entry: int(entry.get("createdAt", 0)),
            reverse=True,
        )[:300]:
            post_id = str(item.get("id", ""))
            raw_ratings = data["ratings"].get(post_id, {})
            if not isinstance(raw_ratings, dict):
                raw_ratings = {}
            ratings = []
            for entry in raw_ratings.values():
                if not isinstance(entry, dict):
                    continue
                try:
                    valid_score = 1 <= int(entry.get("score", 0)) <= 5
                except (TypeError, ValueError):
                    valid_score = False
                if valid_score:
                    ratings.append(entry)
            feedback = []
            for entry in sorted(ratings, key=lambda rating: int(rating.get("updatedAt", 0)), reverse=True)[:60]:
                feedback_id = str(entry.get("id", ""))
                feedback.append({**entry, **community_vote_snapshot(data["feedbackVotes"], feedback_id, viewer)})
            score_total = sum(int(entry.get("score", 0)) for entry in ratings)
            posts.append({
                **item,
                "ratingAverage": round(score_total / len(ratings), 1) if ratings else 0,
                "ratingCount": len(ratings),
                "viewerRating": raw_ratings.get(viewer) if viewer else None,
                "feedback": feedback,
            })
        return {
            "profiles": profiles,
            "messages": messages,
            "posts": posts,
            "following": data["follows"].get(viewer, []) if viewer else [],
            "followedStrategies": data["strategyFollows"].get(viewer, []) if viewer else [],
            "reactedPosts": [
                post_id for post_id, user_ids in data["reactions"].items()
                if isinstance(user_ids, list) and viewer in user_ids
            ] if viewer else [],
            "activeNow": len(_community_presence),
            "asOf": int(time.time()),
            "persistence": "temporary" if DEMO_MODE else "local-file",
        }


def save_community_profile(payload: dict) -> dict:
    user_id = community_id(payload.get("userId"))
    display_name = community_text(payload.get("displayName"), 40, "Nome", 2)
    handle = community_text(payload.get("handle"), 24, "Handle", 3).lower().lstrip("@")
    if not all(char.isalnum() or char == "_" for char in handle):
        raise ValueError("L'handle puo contenere solo lettere, numeri e underscore.")
    bio = community_text(payload.get("bio"), 180, "Bio")
    experience = str(payload.get("experience", "beginner"))
    if experience not in {"beginner", "intermediate", "advanced"}:
        experience = "beginner"
    focus = []
    for item in payload.get("focus", []):
        cleaned = community_text(item, 18, "Focus").upper()
        if cleaned and cleaned not in focus:
            focus.append(cleaned)
    with _community_lock:
        data = load_community_unlocked()
        for profile_id, profile in data["profiles"].items():
            if profile_id != user_id and isinstance(profile, dict) and profile.get("handle") == handle:
                raise ValueError("Questo handle e gia in uso.")
        previous = data["profiles"].get(user_id, {})
        profile = {
            "id": user_id,
            "displayName": display_name,
            "handle": handle,
            "bio": bio,
            "experience": experience,
            "focus": focus[:5],
            "createdAt": int(previous.get("createdAt", time.time())),
            "updatedAt": int(time.time()),
        }
        data["profiles"][user_id] = profile
        write_community_unlocked(data)
    return profile


def add_community_message(payload: dict) -> dict:
    user_id = community_id(payload.get("userId"))
    body = community_text(payload.get("body"), 400, "Messaggio")
    attachment = community_attachment(payload.get("attachment"))
    if len(body) < 2 and not attachment:
        raise ValueError("Inserisci un messaggio oppure allega un'immagine.")
    category = str(payload.get("category", "idea"))
    if category not in {"idea", "question", "source", "risk"}:
        category = "idea"
    asset = community_text(payload.get("asset"), 12, "Asset").upper()
    with _community_lock:
        data = load_community_unlocked()
        if user_id not in data["profiles"]:
            raise ValueError("Completa il profilo community prima di scrivere.")
        message = {"id": uuid.uuid4().hex, "authorId": user_id, "body": body, "category": category, "asset": asset, "attachment": attachment, "createdAt": int(time.time())}
        data["messages"] = ([item for item in data["messages"] if isinstance(item, dict)] + [message])[-500:]
        write_community_unlocked(data)
    return message


def add_community_post(payload: dict) -> dict:
    user_id = community_id(payload.get("userId"))
    kind = str(payload.get("kind", "analysis"))
    if kind not in {"analysis", "strategy", "question", "lesson"}:
        kind = "analysis"
    title = community_text(payload.get("title"), 100, "Titolo", 5)
    body = community_text(payload.get("body"), 2200, "Contenuto", 30)
    asset = community_text(payload.get("asset"), 18, "Asset").upper()
    timeframe = str(payload.get("timeframe", "not-set"))
    if timeframe not in {"intraday", "week", "month", "long-term", "not-set"}:
        timeframe = "not-set"
    risk = str(payload.get("risk", "not-assessed"))
    if risk not in {"low", "medium", "high", "not-assessed"}:
        risk = "not-assessed"
    thesis = community_text(payload.get("thesis"), 1200, "Tesi")
    invalidation = community_text(payload.get("invalidation"), 800, "Invalidazione")
    source_url = str(payload.get("sourceUrl", "")).strip()[:500]
    attachment = community_attachment(payload.get("attachment"))
    if source_url:
        parsed = urllib.parse.urlparse(source_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("La fonte deve essere un URL HTTPS completo.")
    if kind == "strategy" and (len(thesis) < 30 or len(invalidation) < 20):
        raise ValueError("Una strategia richiede una tesi e una condizione di invalidazione concrete.")
    quality = sum((len(thesis) >= 30, len(invalidation) >= 20, risk != "not-assessed", bool(source_url)))
    with _community_lock:
        data = load_community_unlocked()
        if user_id not in data["profiles"]:
            raise ValueError("Completa il profilo community prima di pubblicare.")
        post = {
            "id": uuid.uuid4().hex,
            "authorId": user_id,
            "kind": kind,
            "title": title,
            "body": body,
            "asset": asset,
            "timeframe": timeframe,
            "risk": risk,
            "thesis": thesis,
            "invalidation": invalidation,
            "sourceUrl": source_url,
            "attachment": attachment,
            "quality": quality,
            "createdAt": int(time.time()),
            "reactionCount": 0,
            "strategyFollowerCount": 0,
        }
        data["posts"] = ([item for item in data["posts"] if isinstance(item, dict)] + [post])[-300:]
        write_community_unlocked(data)
    return post


def save_community_rating(payload: dict) -> dict:
    user_id = community_id(payload.get("userId"))
    post_id = community_id(payload.get("postId"), "contributo")
    try:
        score = int(payload.get("score", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("Seleziona un voto da 1 a 5.") from exc
    if score < 1 or score > 5:
        raise ValueError("Seleziona un voto da 1 a 5.")
    feedback = community_text(payload.get("feedback"), 600, "Feedback")
    with _community_lock:
        data = load_community_unlocked()
        if user_id not in data["profiles"]:
            raise ValueError("Profilo community non trovato.")
        post = next((item for item in data["posts"] if isinstance(item, dict) and item.get("id") == post_id), None)
        if not post:
            raise ValueError("Contributo non trovato.")
        if post.get("authorId") == user_id:
            raise ValueError("Non puoi valutare il tuo contributo.")
        post_ratings = data["ratings"].setdefault(post_id, {})
        previous = post_ratings.get(user_id, {}) if isinstance(post_ratings.get(user_id), dict) else {}
        now = int(time.time())
        rating = {
            "id": str(previous.get("id") or uuid.uuid4().hex),
            "postId": post_id,
            "authorId": user_id,
            "score": score,
            "feedback": feedback,
            "createdAt": int(previous.get("createdAt", now)),
            "updatedAt": now,
        }
        post_ratings[user_id] = rating
        write_community_unlocked(data)
    return rating


def update_community_relation(payload: dict) -> dict:
    user_id = community_id(payload.get("userId"))
    action = str(payload.get("action", ""))
    target_id = community_id(payload.get("targetId"), "destinazione")
    active = bool(payload.get("active", True))
    with _community_lock:
        data = load_community_unlocked()
        if user_id not in data["profiles"]:
            raise ValueError("Profilo community non trovato.")
        vote_actions = {
            "message-like": ("messageVotes", "like"),
            "message-dislike": ("messageVotes", "dislike"),
            "feedback-like": ("feedbackVotes", "like"),
            "feedback-dislike": ("feedbackVotes", "dislike"),
        }
        if action in vote_actions:
            store_key, sentiment = vote_actions[action]
            if store_key == "messageVotes":
                target = next((item for item in data["messages"] if isinstance(item, dict) and item.get("id") == target_id), None)
            else:
                target = next((
                    entry
                    for post_ratings in data["ratings"].values() if isinstance(post_ratings, dict)
                    for entry in post_ratings.values()
                    if isinstance(entry, dict) and entry.get("id") == target_id
                ), None)
            if not target:
                raise ValueError("Contenuto da votare non trovato.")
            if target.get("authorId") == user_id:
                raise ValueError("Non puoi votare il tuo contenuto.")
            bucket = data[store_key].setdefault(target_id, {"likes": [], "dislikes": []})
            if not isinstance(bucket, dict):
                bucket = {"likes": [], "dislikes": []}
            selected_key = "likes" if sentiment == "like" else "dislikes"
            other_key = "dislikes" if sentiment == "like" else "likes"
            selected = [str(item) for item in bucket.get(selected_key, []) if isinstance(item, str)]
            other = [str(item) for item in bucket.get(other_key, []) if isinstance(item, str) and item != user_id]
            if active and user_id not in selected:
                selected.append(user_id)
            if not active:
                selected = [item for item in selected if item != user_id]
            bucket = {selected_key: list(dict.fromkeys(selected)), other_key: list(dict.fromkeys(other))}
            data[store_key][target_id] = bucket
            write_community_unlocked(data)
            snapshot = community_vote_snapshot(data[store_key], target_id, user_id)
            return {"action": action, "targetId": target_id, "active": active, **snapshot}
        if action == "follow-profile":
            if target_id == user_id or target_id not in data["profiles"]:
                raise ValueError("Profilo da seguire non valido.")
            bucket = data["follows"].setdefault(user_id, [])
            count_field = None
        elif action == "follow-strategy":
            if not any(item.get("id") == target_id and item.get("kind") == "strategy" for item in data["posts"] if isinstance(item, dict)):
                raise ValueError("Strategia non trovata.")
            bucket = data["strategyFollows"].setdefault(user_id, [])
            count_field = "strategyFollowerCount"
        elif action == "react":
            if not any(item.get("id") == target_id for item in data["posts"] if isinstance(item, dict)):
                raise ValueError("Post non trovato.")
            bucket = data["reactions"].setdefault(target_id, [])
            count_field = "reactionCount"
        else:
            raise ValueError("Azione community non valida.")
        values = [str(item) for item in bucket if isinstance(item, str)]
        member_id = user_id if action == "react" else target_id
        if active and member_id not in values:
            values.append(member_id)
        if not active:
            values = [item for item in values if item != member_id]
        if action == "react":
            data["reactions"][target_id] = values
        elif action == "follow-profile":
            data["follows"][user_id] = values
        else:
            data["strategyFollows"][user_id] = values
        if count_field:
            for post in data["posts"]:
                if isinstance(post, dict) and post.get("id") == target_id:
                    if action == "follow-strategy":
                        post[count_field] = sum(target_id in items for items in data["strategyFollows"].values() if isinstance(items, list))
                    else:
                        post[count_field] = len(values)
        write_community_unlocked(data)
    return {"action": action, "targetId": target_id, "active": active}


def normalized_header(value: str) -> str:
    return "".join(ch for ch in value.strip().lower() if ch.isalnum())


def first_value(row: dict[str, str], *aliases: str) -> str:
    normalized = {normalized_header(key): (value or "").strip() for key, value in row.items() if key}
    for alias in aliases:
        value = normalized.get(normalized_header(alias), "")
        if value:
            return value
    return ""


def parse_decimal(value: str) -> float | None:
    cleaned = value.strip().replace("\u00a0", "").replace("€", "")
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".") if cleaned.rfind(",") > cleaned.rfind(".") else cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def classify_transaction(raw_type: str) -> str:
    value = raw_type.strip().lower().replace("_", " ").replace("-", " ")
    if any(term in value for term in ("buy", "acquisto")):
        return "buy"
    if any(term in value for term in ("sell", "vendita")):
        return "sell"
    if any(term in value for term in ("deposit", "receive", "ricev")):
        return "deposit"
    if any(term in value for term in ("withdraw", "send", "preliev", "invio")):
        return "withdrawal"
    if any(term in value for term in ("staking", "reward", "earn", "airdrop", "ricomp")):
        return "reward"
    if "fee" in value or "commission" in value:
        return "fee"
    if "trade" in value:
        return "trade"
    return value[:40] or "unknown"


def split_pair(pair: str) -> tuple[str, str]:
    cleaned = pair.upper().replace("/", "").replace("-", "").replace("_", "")
    replacements = {"XXBT": "BTC", "XBT": "BTC", "XETH": "ETH", "ZEUR": "EUR", "ZUSD": "USD"}
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)
    for quote in ("USDT", "USDC", "EUR", "USD", "GBP", "BTC", "ETH"):
        if cleaned.endswith(quote) and len(cleaned) > len(quote):
            return cleaned[:-len(quote)], quote
    return cleaned, ""


def normalize_csv_row(exchange: str, row: dict[str, str], row_number: int) -> tuple[dict | None, str | None]:
    timestamp = first_value(row, "timestamp", "time", "date", "created at", "datetime")
    raw_type = first_value(row, "transaction type", "type", "side", "operation")
    asset = first_value(row, "asset", "currency", "symbol", "base currency", "base asset").upper()
    amount_text = first_value(row, "quantity transacted", "amount", "quantity", "volume", "vol", "base amount")
    quote_asset = first_value(row, "spot price currency", "quote currency", "quote asset", "counter currency").upper()
    quote_text = first_value(row, "total inclusive of fees andor spread", "subtotal", "cost", "quote amount", "total")
    price_text = first_value(row, "spot price at transaction", "price", "rate")
    fee_text = first_value(row, "fees andor spread", "fee", "commission")
    fee_asset = first_value(row, "fee currency", "fee asset", "commission currency").upper()
    pair = first_value(row, "pair", "market", "product", "trading pair")

    if exchange == "kraken" and pair:
        pair_asset, pair_quote = split_pair(pair)
        asset = asset or pair_asset
        quote_asset = quote_asset or pair_quote
    amount = parse_decimal(amount_text)
    quote_amount = parse_decimal(quote_text)
    price = parse_decimal(price_text)
    fee = parse_decimal(fee_text)
    transaction_type = classify_transaction(raw_type)

    # Kraken ledger exports use signed amounts. Preserve the sign but infer movement type.
    if exchange == "kraken" and transaction_type == "unknown" and amount is not None:
        transaction_type = "deposit" if amount > 0 else "withdrawal"
    if transaction_type in {"sell", "withdrawal", "fee"} and amount is not None:
        amount = abs(amount)
    if not timestamp:
        return None, f"Riga {row_number}: data/ora non riconosciuta"
    if not asset and not pair:
        return None, f"Riga {row_number}: asset non riconosciuto"
    if amount is None and quote_amount is None:
        return None, f"Riga {row_number}: importo non riconosciuto"

    normalized = {
        "exchange": exchange,
        "timestamp": timestamp[:80],
        "type": transaction_type,
        "rawType": raw_type[:80],
        "asset": asset[:20],
        "amount": amount,
        "quoteAsset": quote_asset[:20],
        "quoteAmount": quote_amount,
        "price": price,
        "feeAsset": (fee_asset or quote_asset or asset)[:20],
        "feeAmount": abs(fee) if fee is not None else None,
        "sourceRow": row_number,
    }
    fingerprint_source = json.dumps({key: normalized[key] for key in normalized if key != "sourceRow"}, sort_keys=True, ensure_ascii=False)
    normalized["fingerprint"] = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()
    return normalized, None


def preview_csv_import(payload: dict) -> dict:
    exchange = str(payload.get("exchange", "")).strip().lower()
    if exchange not in {"coinbase", "kraken", "bitvavo"}:
        raise ValueError("Exchange non supportato.")
    content = str(payload.get("csv", ""))
    filename = str(payload.get("filename", "import.csv")).strip()[:160]
    if not content or len(content.encode("utf-8")) > 2_500_000:
        raise ValueError("CSV vuoto o superiore a 2,5 MB.")
    sample = content[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("Intestazioni CSV non trovate.")
    rows, errors = [], []
    for row_number, row in enumerate(reader, start=2):
        if row_number > 5001:
            errors.append("Import limitato alle prime 5.000 righe.")
            break
        normalized, error = normalize_csv_row(exchange, row, row_number)
        if normalized:
            rows.append(normalized)
        elif error and len(errors) < 30:
            errors.append(error)
    if not rows:
        raise ValueError("Nessuna transazione riconosciuta. Controlla il tipo di export CSV.")
    token = uuid.uuid4().hex
    now = time.time()
    for key in list(_import_previews):
        if now - float(_import_previews[key].get("created", 0)) > 1800:
            _import_previews.pop(key, None)
    _import_previews[token] = {"created": now, "exchange": exchange, "filename": filename, "rows": rows}
    return {
        "token": token,
        "exchange": exchange,
        "filename": filename,
        "columns": reader.fieldnames[:30],
        "recognized": len(rows),
        "skipped": len(errors),
        "errors": errors[:10],
        "preview": rows[:12],
    }


def confirm_csv_import(token: str) -> dict:
    preview = _import_previews.pop(token, None)
    if not preview or time.time() - float(preview.get("created", 0)) > 1800:
        raise ValueError("Anteprima scaduta: seleziona nuovamente il CSV.")
    existing = load_transactions()
    fingerprints = {item.get("fingerprint") for item in existing}
    batch_id = uuid.uuid4().hex
    imported = []
    for row in preview["rows"]:
        if row["fingerprint"] in fingerprints:
            continue
        entry = dict(row)
        entry.update({"id": uuid.uuid4().hex, "batchId": batch_id, "importedAt": int(time.time()), "filename": preview["filename"]})
        imported.append(entry)
        fingerprints.add(row["fingerprint"])
    if imported:
        write_transactions(existing + imported)
    return {"batchId": batch_id, "imported": len(imported), "duplicates": len(preview["rows"]) - len(imported), "total": len(existing) + len(imported)}


def add_journal_entry(payload: dict) -> dict:
    coin_id = str(payload.get("coinId", "")).strip()[:100]
    symbol = str(payload.get("symbol", "")).strip().upper()[:15]
    if not coin_id or not symbol or not all(ch.isalnum() or ch in "-_" for ch in coin_id):
        raise ValueError("Crypto non valida.")
    action = str(payload.get("action", "watch")).lower()
    emotion = str(payload.get("emotion", "calmo")).lower()
    if action not in {"buy", "sell", "watch", "rebalance"}:
        action = "watch"
    if emotion not in {"calmo", "fomo", "paura", "incerto"}:
        emotion = "incerto"
    try:
        amount = min(100_000_000, max(0.0, float(payload.get("amount", 0))))
        score = min(100, max(0, int(payload.get("score", 0))))
    except (TypeError, ValueError):
        amount, score = 0.0, 0
    entry = {
        "id": uuid.uuid4().hex,
        "createdAt": int(time.time()),
        "coinId": coin_id,
        "symbol": symbol,
        "action": action,
        "amount": amount,
        "thesis": str(payload.get("thesis", "")).strip()[:2000],
        "invalidation": str(payload.get("invalidation", "")).strip()[:2000],
        "emotion": emotion,
        "followedPlan": bool(payload.get("followedPlan", False)),
        "score": score,
    }
    entries = load_journal()
    entries.insert(0, entry)
    write_journal(entries[:1000])
    return entry


def simulate_dca(coin_id: str, months: int, monthly: float) -> dict:
    days = min(365, months * 31 + 7)
    history = coingecko_get(
        f"/coins/{coin_id}/market_chart",
        {"vs_currency": "eur", "days": str(days)},
        ttl=900,
    )
    prices = history.get("prices", []) if isinstance(history, dict) else []
    if len(prices) < 2:
        raise RuntimeError("Storico insufficiente per la simulazione selezionata.")
    end_ts = prices[-1][0]
    start_ts = end_ts - months * 30 * 86_400_000
    purchases = []
    cursor = 0
    for index in range(months):
        target_ts = start_ts + index * 30 * 86_400_000
        while cursor < len(prices) - 1 and prices[cursor][0] < target_ts:
            cursor += 1
        price = float(prices[cursor][1])
        if price > 0:
            purchases.append({"date": int(prices[cursor][0]), "price": price, "units": monthly / price})
    if not purchases:
        raise RuntimeError("Nessun acquisto simulabile nel periodo richiesto.")
    invested = monthly * len(purchases)
    units = sum(item["units"] for item in purchases)
    current_price = float(prices[-1][1])
    current_value = units * current_price
    lump_units = invested / purchases[0]["price"]
    lump_value = lump_units * current_price
    return {
        "coinId": coin_id,
        "months": len(purchases),
        "monthly": monthly,
        "invested": invested,
        "units": units,
        "averageCost": invested / units,
        "currentPrice": current_price,
        "currentValue": current_value,
        "returnPct": (current_value / invested - 1) * 100,
        "lumpValue": lump_value,
        "lumpReturnPct": (lump_value / invested - 1) * 100,
        "firstPurchase": purchases[0]["date"],
        "lastPurchase": purchases[-1]["date"],
    }


def coingecko_get(path: str, params: dict[str, str], ttl: int) -> object:
    query = urllib.parse.urlencode(params)
    url = f"{COINGECKO}{path}?{query}"
    now = time.time()
    cached = _cache.get(url)
    if cached and now - cached[0] < ttl:
        return cached[1]

    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "CryptoRadar/0.1 local-dashboard"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
            _cache[url] = (now, data)
            return data
    except urllib.error.HTTPError as exc:
        if cached:
            return cached[1]
        if exc.code == 429:
            raise RuntimeError("Limite temporaneo CoinGecko raggiunto. Riprova tra circa un minuto.") from exc
        raise RuntimeError(f"CoinGecko ha risposto con errore HTTP {exc.code}.") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        if cached:
            return cached[1]
        raise RuntimeError("Dati CoinGecko non disponibili. Controlla la connessione e riprova.") from exc


def load_rss_feed(url: str, source: str, language: str) -> list[dict]:
    now = time.time()
    cached = _cache.get(url)
    if cached and now - cached[0] < 600:
        return cached[1]  # type: ignore[return-value]
    request = urllib.request.Request(url, headers={"User-Agent": "CryptoRadar/0.3 local-dashboard"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            root = ET.fromstring(response.read())
    except (urllib.error.URLError, TimeoutError, ET.ParseError) as exc:
        if cached:
            return cached[1]  # type: ignore[return-value]
        raise RuntimeError(f"Feed {source} temporaneamente non disponibile.") from exc

    keywords = {
        "POL": ("polygon", "matic", " pol "),
        "ALGO": ("algorand", " algo "),
        "ADA": ("cardano", " ada "),
        "BTC": ("bitcoin", " btc "),
        "ETH": ("ethereum", " ether", " eth "),
    }
    articles = []
    for item in root.findall(".//item")[:35]:
        title = (item.findtext("title") or "").strip()
        description = (item.findtext("description") or "").strip()
        combined = f" {title} {description} ".lower()
        tags = [symbol for symbol, terms in keywords.items() if any(term in combined for term in terms)]
        published = item.findtext("pubDate") or ""
        try:
            published = parsedate_to_datetime(published).isoformat()
        except (TypeError, ValueError):
            pass
        articles.append({
            "title": title,
            "link": (item.findtext("link") or "").strip(),
            "published": published,
            "source": source,
            "sourceLanguage": language,
            "tags": tags,
        })
    _cache[url] = (now, articles)
    return articles


def load_news() -> list[dict]:
    articles: list[dict] = []
    errors = []
    for url, source, language in (
        (COINDESK_RSS, "CoinDesk", "en"),
        (CRIPTOVALUTA_RSS, "Criptovaluta.it", "it"),
    ):
        try:
            articles.extend(load_rss_feed(url, source, language))
        except RuntimeError as exc:
            errors.append(str(exc))
    if not articles:
        raise RuntimeError("Feed delle notizie temporaneamente non disponibili: " + "; ".join(errors))

    def published_timestamp(article: dict) -> float:
        try:
            return parsedate_to_datetime(str(article.get("published", ""))).timestamp()
        except (TypeError, ValueError):
            try:
                return datetime.fromisoformat(str(article.get("published", ""))).timestamp()
            except (TypeError, ValueError):
                return 0

    articles.sort(key=published_timestamp, reverse=True)
    return articles[:70]


def news_translation_file(language: str) -> Path:
    return TRANSLATIONS_FILE if language == "it" else DATA_DIR / f"news_translations_{language}.json"


def load_translation_cache(language: str = "it") -> dict[str, str]:
    try:
        data = json.loads(news_translation_file(language).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, json.JSONDecodeError):
        return {}


def translate_title(title: str, source: str = "en", target: str = "it") -> str:
    params = urllib.parse.urlencode({"q": title[:450], "langpair": f"{source}|{target}", "mt": "1"})
    url = f"https://api.mymemory.translated.net/get?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "CryptoRadar/0.2"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        translated = html.unescape(str(payload.get("responseData", {}).get("translatedText", ""))).strip()
        return translated if translated and translated.lower() != title.lower() else title
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return title


def _translate_news_unlocked(language: str = "it") -> dict[str, str]:
    language = language if language in {"it", "en", "es"} else "it"
    articles = load_news()[:25]
    cache = load_translation_cache(language)
    translated_articles = [article for article in articles if article.get("sourceLanguage") != language]
    titles = [article["title"] for article in translated_articles]
    missing = [article for article in translated_articles if article["title"] not in cache]
    if missing:
        with ThreadPoolExecutor(max_workers=4) as executor:
            jobs = {executor.submit(translate_title, article["title"], str(article.get("sourceLanguage", "en")), language): article["title"] for article in missing}
            for job in as_completed(jobs):
                title = jobs[job]
                try:
                    cache[title] = job.result()
                except Exception:
                    cache[title] = title
        DATA_DIR.mkdir(exist_ok=True)
        destination = news_translation_file(language)
        temp = destination.with_suffix(".tmp")
        temp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(destination)
    return {title: cache.get(title, title) for title in titles}


def translate_news(language: str = "it") -> dict[str, str]:
    language = language if language in _translation_locks else "it"
    with _translation_locks[language]:
        return _translate_news_unlocked(language)


def public_json(url: str, ttl: int = 30) -> object:
    now = time.time()
    cached = _cache.get(url)
    if cached and now - cached[0] < ttl:
        return cached[1]
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "CryptoRadar/0.5 market-research"})
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
        _cache[url] = (now, data)
        return data
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        if cached:
            return cached[1]
        raise RuntimeError("Fonte di mercato temporaneamente non disponibile.") from exc


def coinmarketcap_market_movers() -> dict:
    params = urllib.parse.urlencode({"start": "1", "limit": "100", "convert": "EUR"})
    payload = public_json(f"{COINMARKETCAP_PUBLIC}/v3/cryptocurrency/listings/latest?{params}", ttl=300)
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise RuntimeError("CoinMarketCap non ha restituito una classifica valida.")
    status = payload.get("status") if isinstance(payload.get("status"), dict) else {}
    if str(status.get("error_code", "0")) != "0":
        raise RuntimeError(str(status.get("error_message") or "CoinMarketCap non disponibile."))

    assets = []
    for item in payload["data"]:
        if not isinstance(item, dict):
            continue
        raw_quote = item.get("quote")
        if isinstance(raw_quote, list):
            quote = next((entry for entry in raw_quote if isinstance(entry, dict) and entry.get("symbol") == "EUR"), None)
        elif isinstance(raw_quote, dict):
            quote = raw_quote.get("EUR")
        else:
            quote = None
        if not isinstance(quote, dict):
            continue
        try:
            change_7d = float(quote.get("percent_change_7d"))
            price = float(quote.get("price"))
            market_cap = float(quote.get("market_cap"))
            rank = int(item.get("cmc_rank"))
            cmc_id = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        name = str(item.get("name", "")).strip()
        tags = {str(tag).lower() for tag in item.get("tags", []) if isinstance(tag, str)}
        excluded_name = any(term in name.lower() for term in ("wrapped", "bridged", "staked", "restaked", "liquid staking"))
        if "stablecoin" in tags or excluded_name or not name or not 1 <= rank <= 100:
            continue
        assets.append({
            "cmcId": cmc_id,
            "name": name,
            "symbol": str(item.get("symbol", "")).strip().upper()[:15],
            "slug": str(item.get("slug", "")).strip(),
            "rank": rank,
            "price": price,
            "marketCap": market_cap,
            "change7d": change_7d,
            "lastUpdated": str(quote.get("last_updated") or item.get("last_updated") or ""),
            "image": f"https://s2.coinmarketcap.com/static/img/coins/64x64/{cmc_id}.png",
        })

    gainers = sorted((asset for asset in assets if asset["change7d"] > 0), key=lambda asset: asset["change7d"], reverse=True)[:5]
    losers = sorted((asset for asset in assets if asset["change7d"] < 0), key=lambda asset: asset["change7d"])[:5]
    return {
        "source": "CoinMarketCap",
        "sourceUrl": "https://coinmarketcap.com/",
        "asOf": str(status.get("timestamp") or ""),
        "universe": "Prime 100 crypto per capitalizzazione CoinMarketCap, escluse stablecoin e versioni wrapped/staked.",
        "eligibleCount": len(assets),
        "gainers": gainers,
        "losers": losers,
    }


def coinmarketcap_catalog(query: str = "", sort_mode: str = "rank", selected_ids: set[str] | None = None) -> dict:
    cache_key = "coinmarketcap-catalog-normalized"
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < 1800:
        catalog = cached[1]
    else:
        params = urllib.parse.urlencode({"start": "1", "limit": "5000", "convert": "EUR"})
        try:
            payload = public_json(f"{COINMARKETCAP_PUBLIC}/v3/cryptocurrency/listings/latest?{params}", ttl=1800)
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise RuntimeError("CoinMarketCap non ha restituito un catalogo valido.")
            status = payload.get("status") if isinstance(payload.get("status"), dict) else {}
            if str(status.get("error_code", "0")) != "0":
                raise RuntimeError(str(status.get("error_message") or "Catalogo CoinMarketCap non disponibile."))

            assets = []
            for item in payload["data"]:
                if not isinstance(item, dict):
                    continue
                raw_quote = item.get("quote")
                if isinstance(raw_quote, list):
                    quote = next((entry for entry in raw_quote if isinstance(entry, dict) and entry.get("symbol") == "EUR"), None)
                elif isinstance(raw_quote, dict):
                    quote = raw_quote.get("EUR")
                else:
                    quote = None
                if not isinstance(quote, dict):
                    continue
                try:
                    cmc_id = int(item.get("id"))
                    rank = int(item.get("cmc_rank"))
                except (TypeError, ValueError):
                    continue
                name = str(item.get("name", "")).strip()
                symbol = str(item.get("symbol", "")).strip().lower()
                slug = str(item.get("slug", "")).strip()
                if not name or not symbol or not slug or rank < 1:
                    continue
                assets.append({
                    "id": f"cmc-{cmc_id}",
                    "cmc_id": cmc_id,
                    "cmc_slug": slug,
                    "catalog_source": "coinmarketcap",
                    "name": name,
                    "symbol": symbol,
                    "image": f"https://s2.coinmarketcap.com/static/img/coins/64x64/{cmc_id}.png",
                    "current_price": quote.get("price"),
                    "market_cap": quote.get("market_cap"),
                    "market_cap_rank": rank,
                    "fully_diluted_valuation": quote.get("fully_diluted_market_cap"),
                    "total_volume": quote.get("volume_24h"),
                    "price_change_percentage_1h_in_currency": quote.get("percent_change_1h"),
                    "price_change_percentage_24h_in_currency": quote.get("percent_change_24h"),
                    "price_change_percentage_7d_in_currency": quote.get("percent_change_7d"),
                    "price_change_percentage_30d_in_currency": quote.get("percent_change_30d"),
                    "price_change_percentage_1y_in_currency": None,
                    "sparkline_in_7d": {"price": []},
                })
            if not assets:
                raise RuntimeError("Il catalogo CoinMarketCap è vuoto.")
            catalog = {"data": assets, "source": "coinmarketcap", "asOf": str(status.get("timestamp") or "")}
        except RuntimeError:
            fallback = json.loads(MARKET_FALLBACK_FILE.read_text(encoding="utf-8"))
            catalog = {"data": fallback["data"], "source": "fallback", "asOf": fallback["generatedAt"]}
        _cache[cache_key] = (now, catalog)

    assets = catalog["data"]
    needle = query.strip().casefold()
    matches = [
        asset for asset in assets
        if not needle or needle in f"{asset.get('name', '')} {asset.get('symbol', '')} {asset.get('cmc_slug', '')} #{asset.get('market_cap_rank', '')}".casefold()
    ]
    if sort_mode == "name":
        matches.sort(key=lambda asset: (str(asset.get("name", "")).casefold(), int(asset.get("market_cap_rank") or 999999)))
    else:
        matches.sort(key=lambda asset: (int(asset.get("market_cap_rank") or 999999), str(asset.get("name", "")).casefold()))
    selected_ids = selected_ids or set()
    selected = [asset for asset in assets if str(asset.get("id", "")) in selected_ids]
    visible = selected + [asset for asset in matches if str(asset.get("id", "")) not in selected_ids][:100]
    return {
        "data": visible,
        "total": len(assets),
        "matched": len(matches),
        "source": catalog["source"],
        "asOf": catalog["asOf"],
    }


def coinmarketcap_market_intelligence() -> dict:
    endpoints = {
        "fear": f"{COINMARKETCAP_PUBLIC}/v3/fear-and-greed/latest",
        "fearHistory": f"{COINMARKETCAP_PUBLIC}/v3/fear-and-greed/historical?start=1&limit=30",
        "altcoin": f"{COINMARKETCAP_PUBLIC}/v1/altcoin-season-index/latest",
        "altcoinHistory": f"{COINMARKETCAP_PUBLIC}/v1/altcoin-season-index/historical?timeframe=30d",
        "global": f"{COINMARKETCAP_PUBLIC}/v1/global-metrics/quotes/latest?convert=EUR",
        "cmc100": f"{COINMARKETCAP_PUBLIC}/v3/index/cmc100-latest",
        "listings": f"{COINMARKETCAP_PUBLIC}/v3/cryptocurrency/listings/latest?start=1&limit=100&convert=EUR",
    }
    results: dict[str, dict] = {}
    errors: dict[str, str] = {}

    def fetch(name: str, url: str) -> tuple[str, object]:
        return name, public_json(url, ttl=300)

    with ThreadPoolExecutor(max_workers=7) as executor:
        jobs = {executor.submit(fetch, name, url): name for name, url in endpoints.items()}
        for job in as_completed(jobs):
            name = jobs[job]
            try:
                key, payload = job.result()
                if isinstance(payload, dict):
                    results[key] = payload
                else:
                    errors[name] = "Risposta non valida"
            except Exception as exc:
                errors[name] = str(exc)

    fear = results.get("fear", {}).get("data", {})
    fear_history = results.get("fearHistory", {}).get("data", [])
    altcoin = results.get("altcoin", {}).get("data", {})
    altcoin_history = results.get("altcoinHistory", {}).get("data", {}).get("points", [])
    global_data = results.get("global", {}).get("data", {})
    global_quote = global_data.get("quote", {}).get("EUR", {}) if isinstance(global_data, dict) else {}
    cmc100 = results.get("cmc100", {}).get("data", {})
    listing_rows = results.get("listings", {}).get("data", [])
    assets = []
    for item in listing_rows if isinstance(listing_rows, list) else []:
        if not isinstance(item, dict):
            continue
        raw_quote = item.get("quote")
        quote = next((entry for entry in raw_quote if isinstance(entry, dict) and entry.get("symbol") == "EUR"), {}) if isinstance(raw_quote, list) else (raw_quote.get("EUR", {}) if isinstance(raw_quote, dict) else {})
        assets.append({
            "cmcId": item.get("id"),
            "name": item.get("name"),
            "symbol": item.get("symbol"),
            "rank": item.get("cmc_rank"),
            "platform": item.get("platform", {}).get("name") if isinstance(item.get("platform"), dict) else f"{item.get('symbol', 'Asset')} native",
            "tags": [tag for tag in item.get("tags", []) if isinstance(tag, str)],
            "price": quote.get("price"),
            "marketCap": quote.get("market_cap"),
            "change24h": quote.get("percent_change_24h"),
            "change7d": quote.get("percent_change_7d"),
        })

    as_of_candidates = [
        results.get("fear", {}).get("status", {}).get("timestamp"),
        results.get("global", {}).get("status", {}).get("timestamp"),
        results.get("cmc100", {}).get("status", {}).get("timestamp"),
    ]
    return {
        "source": "CoinMarketCap Keyless Public API",
        "sourceUrl": "https://coinmarketcap.com/charts/",
        "asOf": next((value for value in as_of_candidates if value), ""),
        "fearGreed": fear if isinstance(fear, dict) else {},
        "fearHistory": fear_history if isinstance(fear_history, list) else [],
        "altcoinSeason": altcoin if isinstance(altcoin, dict) else {},
        "altcoinHistory": altcoin_history if isinstance(altcoin_history, list) else [],
        "global": {
            "btcDominance": global_data.get("btc_dominance"),
            "ethDominance": global_data.get("eth_dominance"),
            "btcDominanceChange24h": global_data.get("btc_dominance_24h_percentage_change"),
            "activeCryptocurrencies": global_data.get("active_cryptocurrencies"),
            "activeExchanges": global_data.get("active_exchanges"),
            "activeMarketPairs": global_data.get("active_market_pairs"),
            "totalMarketCap": global_quote.get("total_market_cap"),
            "totalVolume24h": global_quote.get("total_volume_24h"),
            "marketCapChange24h": global_quote.get("total_market_cap_yesterday_percentage_change"),
            "volumeChange24h": global_quote.get("total_volume_24h_yesterday_percentage_change"),
        },
        "cmc100": {
            "value": cmc100.get("value") if isinstance(cmc100, dict) else None,
            "change24h": cmc100.get("value_24h_percentage_change") if isinstance(cmc100, dict) else None,
            "lastUpdate": cmc100.get("last_update") if isinstance(cmc100, dict) else None,
            "constituents": cmc100.get("constituents", []) if isinstance(cmc100, dict) else [],
        },
        "assets": assets,
        "errors": errors,
    }


def normalize_book(source: str, bids: list, asks: list, amount_eur: float, side: str) -> dict:
    clean_bids = sorted([(float(x[0]), float(x[1])) for x in bids if float(x[0]) > 0 and float(x[1]) > 0], reverse=True)
    clean_asks = sorted([(float(x[0]), float(x[1])) for x in asks if float(x[0]) > 0 and float(x[1]) > 0])
    if not clean_bids or not clean_asks:
        raise RuntimeError("Order book vuoto.")
    best_bid, best_ask = clean_bids[0][0], clean_asks[0][0]
    midpoint = (best_bid + best_ask) / 2
    levels = clean_asks if side == "buy" else clean_bids
    target_base = amount_eur / midpoint
    remaining_base = target_base
    gross_eur = 0.0
    filled_base = 0.0
    levels_used = 0
    for price, size in levels:
        take = min(remaining_base, size)
        if take <= 0:
            continue
        gross_eur += take * price
        filled_base += take
        remaining_base -= take
        levels_used += 1
        if remaining_base <= 1e-12:
            break
    fill_pct = min(100.0, filled_base / target_base * 100) if target_base else 0.0
    vwap = gross_eur / filled_base if filled_base else 0.0
    slippage_bps = ((vwap / midpoint - 1) if side == "buy" else (1 - vwap / midpoint)) * 10_000 if vwap else 0.0
    return {
        "source": source,
        "bestBid": best_bid,
        "bestAsk": best_ask,
        "midpoint": midpoint,
        "spreadBps": (best_ask - best_bid) / midpoint * 10_000,
        "vwap": vwap,
        "slippageBps": slippage_bps,
        "fillPct": fill_pct,
        "levelsUsed": levels_used,
        "depthEur": sum(price * size for price, size in levels),
    }


def execution_comparison(symbol: str, amount_eur: float, side: str) -> dict:
    symbol = symbol.upper()
    sources = {
        "Coinbase": f"https://api.exchange.coinbase.com/products/{symbol}-EUR/book?level=2",
        "Kraken": f"https://api.kraken.com/0/public/Depth?pair={symbol}EUR&count=100",
        "Bitvavo": f"https://api.bitvavo.com/v2/{symbol}-EUR/book?depth=100",
    }

    def fetch_book(name: str, url: str) -> dict:
        data = public_json(url)
        if name == "Kraken":
            result = data.get("result", {}) if isinstance(data, dict) else {}
            book = next(iter(result.values())) if result else {}
        else:
            book = data if isinstance(data, dict) else {}
        return normalize_book(name, book.get("bids", []), book.get("asks", []), amount_eur, side)

    books, errors = [], []
    with ThreadPoolExecutor(max_workers=3) as executor:
        jobs = {executor.submit(fetch_book, name, url): name for name, url in sources.items()}
        for job in as_completed(jobs):
            name = jobs[job]
            try:
                books.append(job.result())
            except Exception as exc:
                errors.append({"source": name, "error": str(exc)})
    books.sort(key=lambda item: item["vwap"] if side == "buy" else -item["vwap"])
    return {"symbol": symbol, "amountEur": amount_eur, "side": side, "asOf": int(time.time()), "books": books, "errors": errors}


def risk_price_series(symbols: list[str]) -> dict:
    cleaned = list(dict.fromkeys(symbol.upper() for symbol in symbols if symbol and len(symbol) <= 12 and symbol.replace("-", "").isalnum()))[:15]

    def fetch(symbol: str) -> tuple[str, list[float]]:
        data = public_json(f"https://api.kraken.com/0/public/OHLC?pair={symbol}EUR&interval=60", ttl=300)
        result = data.get("result", {}) if isinstance(data, dict) else {}
        key = next((item for item in result if item != "last"), "")
        rows = result.get(key, []) if key else []
        prices = [float(row[4]) for row in rows if len(row) > 4 and float(row[4]) > 0]
        if len(prices) < 24:
            raise RuntimeError("Storico insufficiente")
        return symbol, prices[-720:]

    series, errors = {}, []
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(cleaned)))) as executor:
        jobs = {executor.submit(fetch, symbol): symbol for symbol in cleaned}
        for job in as_completed(jobs):
            symbol = jobs[job]
            try:
                key, prices = job.result()
                series[key] = prices
            except Exception as exc:
                errors.append({"symbol": symbol, "error": str(exc)})
    return {"series": series, "errors": errors, "source": "Kraken public OHLC", "interval": "1h", "asOf": int(time.time())}


def load_esma_csv(url: str) -> list[dict]:
    now = time.time()
    key = f"csv:{url}"
    cached = _cache.get(key)
    if cached and now - cached[0] < 21_600:
        return cached[1]  # type: ignore[return-value]
    request = urllib.request.Request(url, headers={"Accept": "text/csv", "User-Agent": "CryptoRadar/0.5 regulatory-check"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8-sig", errors="replace")
        rows = list(csv.DictReader(io.StringIO(raw)))
        _cache[key] = (now, rows)
        return rows
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, csv.Error) as exc:
        if cached:
            return cached[1]  # type: ignore[return-value]
        raise RuntimeError("Registro ESMA temporaneamente non disponibile.") from exc


def mica_search(query: str) -> dict:
    needle = query.strip().lower()[:120]
    authorized = load_esma_csv(ESMA_CASP_CSV)
    non_compliant = load_esma_csv(ESMA_NCASP_CSV)

    def matches(row: dict) -> bool:
        return not needle or needle in " ".join(str(value) for value in row.values()).lower()

    def project(row: dict, status: str) -> dict:
        return {
            "status": status,
            "legalName": row.get("ae_lei_name", ""),
            "commercialName": row.get("ae_commercial_name", ""),
            "country": row.get("ae_homeMemberState", ""),
            "authority": row.get("ae_competentAuthority", ""),
            "website": row.get("ae_website", ""),
            "authorisedAt": row.get("ac_authorisationNotificationDate", ""),
            "authorisationEnd": row.get("ac_authorisationEndDate", ""),
            "services": row.get("ac_serviceCode", ""),
            "reason": row.get("ae_reason", ""),
            "decisionDate": row.get("ae_decision_date", ""),
            "lastUpdate": row.get("ac_lastupdate", row.get("ae_lastupdate", "")),
        }

    good = [project(row, "authorised") for row in authorized if matches(row)][:40]
    bad = [project(row, "non-compliant") for row in non_compliant if matches(row)][:40]
    return {"query": query, "authorised": good, "nonCompliant": bad, "counts": {"authorised": len(authorized), "nonCompliant": len(non_compliant)}, "source": "ESMA Interim MiCA Register", "sourceUrl": "https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica", "asOf": int(time.time())}


class Handler(BaseHTTPRequestHandler):
    server_version = "CryptoRadar/0.1"

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                return self.send_json({"ok": True, "time": int(time.time()), "demo": DEMO_MODE})
            if parsed.path == "/api/config":
                return self.send_json({"demo": DEMO_MODE, "writesEnabled": not DEMO_MODE})
            if parsed.path == "/api/community":
                viewer = urllib.parse.parse_qs(parsed.query).get("viewer", [""])[0]
                return self.send_json(community_snapshot(viewer))
            if parsed.path == "/api/portfolio":
                return self.send_json(json.loads(json.dumps(DEFAULT_PORTFOLIO)) if DEMO_MODE else load_portfolio())
            if parsed.path == "/api/plan":
                return self.send_json(json.loads(json.dumps(DEFAULT_PLAN)) if DEMO_MODE else load_plan())
            if parsed.path == "/api/journal":
                return self.send_json({"entries": [] if DEMO_MODE else load_journal()})
            if parsed.path == "/api/transactions":
                transactions = [] if DEMO_MODE else load_transactions()
                batches = {}
                for item in transactions:
                    batch_id = item.get("batchId", "")
                    if batch_id and batch_id not in batches:
                        batches[batch_id] = {"batchId": batch_id, "exchange": item.get("exchange"), "filename": item.get("filename"), "importedAt": item.get("importedAt"), "count": 0}
                    if batch_id:
                        batches[batch_id]["count"] += 1
                return self.send_json({"transactions": transactions[-500:], "total": len(transactions), "batches": sorted(batches.values(), key=lambda x: x.get("importedAt", 0), reverse=True)})
            if parsed.path == "/api/markets":
                try:
                    if FORCE_MARKET_FALLBACK:
                        raise RuntimeError("Fallback market data forced for verification.")
                    data = coingecko_get(
                        "/coins/markets",
                        {
                            "vs_currency": "eur",
                            "order": "market_cap_desc",
                            "per_page": "200",
                            "page": "1",
                            "sparkline": "true",
                            "price_change_percentage": "1h,24h,7d,30d,1y",
                        },
                        ttl=180,
                    )
                    return self.send_json({"data": data, "asOf": int(time.time()), "source": "live", "stale": False})
                except RuntimeError:
                    fallback = json.loads(MARKET_FALLBACK_FILE.read_text(encoding="utf-8"))
                    return self.send_json({"data": fallback["data"], "asOf": fallback["generatedAt"], "source": "fallback", "stale": True})
            if parsed.path == "/api/market-movers":
                return self.send_json(coinmarketcap_market_movers())
            if parsed.path == "/api/market-catalog":
                query = urllib.parse.parse_qs(parsed.query)
                search = query.get("q", [""])[0][:120]
                sort_mode = query.get("sort", ["rank"])[0]
                selected_ids = {value for value in query.get("ids", [""])[0].split(",") if value.startswith("cmc-")}
                return self.send_json(coinmarketcap_catalog(search, sort_mode, selected_ids))
            if parsed.path == "/api/market-intelligence":
                return self.send_json(coinmarketcap_market_intelligence())
            if parsed.path == "/api/trending":
                data = coingecko_get("/search/trending", {}, ttl=600)
                return self.send_json(data)
            if parsed.path == "/api/news":
                return self.send_json({"articles": load_news(), "asOf": int(time.time())})
            if parsed.path == "/api/news-translations":
                language = urllib.parse.parse_qs(parsed.query).get("lang", ["it"])[0]
                language = language if language in {"it", "en", "es"} else "it"
                return self.send_json({"translations": translate_news(language), "language": language})
            if parsed.path == "/api/execution":
                query = urllib.parse.parse_qs(parsed.query)
                symbol = query.get("symbol", [""])[0].strip().upper()
                side = query.get("side", ["buy"])[0]
                if not symbol or len(symbol) > 12 or not symbol.replace("-", "").isalnum() or side not in {"buy", "sell"}:
                    return self.send_json({"error": "Parametri Execution Lab non validi."}, 400)
                try:
                    amount = min(5_000_000, max(10, float(query.get("amount", ["1000"])[0])))
                except (TypeError, ValueError):
                    return self.send_json({"error": "Importo non valido."}, 400)
                return self.send_json(execution_comparison(symbol, amount, side))
            if parsed.path == "/api/risk-series":
                raw = urllib.parse.parse_qs(parsed.query).get("symbols", [""])[0]
                symbols = [symbol.strip() for symbol in raw.split(",") if symbol.strip()]
                if not symbols:
                    return self.send_json({"error": "Indica almeno una crypto per il Risk Engine."}, 400)
                return self.send_json(risk_price_series(symbols))
            if parsed.path == "/api/mica-search":
                query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0]
                return self.send_json(mica_search(query))
            if parsed.path == "/api/history":
                query = urllib.parse.parse_qs(parsed.query)
                coin_id = query.get("id", [""])[0]
                if not coin_id or not all(ch.isalnum() or ch in "-_" for ch in coin_id):
                    return self.send_json({"error": "ID crypto non valido."}, 400)
                data = coingecko_get(
                    f"/coins/{coin_id}/market_chart",
                    {"vs_currency": "eur", "days": "365"},
                    ttl=900,
                )
                return self.send_json(data)
            if parsed.path == "/api/dca":
                query = urllib.parse.parse_qs(parsed.query)
                coin_id = query.get("id", [""])[0]
                if not coin_id or not all(ch.isalnum() or ch in "-_" for ch in coin_id):
                    return self.send_json({"error": "Crypto non valida per il simulatore."}, 400)
                try:
                    months = min(12, max(3, int(query.get("months", ["12"])[0])))
                    monthly = min(1_000_000, max(1, float(query.get("monthly", ["100"])[0])))
                except (TypeError, ValueError):
                    return self.send_json({"error": "Parametri DCA non validi."}, 400)
                return self.send_json(simulate_dca(coin_id, months, monthly))
            return self.serve_static(parsed.path)
        except RuntimeError as exc:
            self.send_json({"error": str(exc)}, 503)
        except Exception:
            self.send_json({"error": "Errore interno inatteso."}, 500)

    def do_POST(self) -> None:  # noqa: N802
        community_paths = {"/api/community/profile", "/api/community/message", "/api/community/post", "/api/community/rating", "/api/community/action"}
        allowed_paths = {"/api/portfolio", "/api/plan", "/api/journal", "/api/import/preview", "/api/import/confirm", "/api/restore-local-backup"} | community_paths
        if self.path not in allowed_paths:
            return self.send_json({"error": "Endpoint non trovato."}, 404)
        if DEMO_MODE and self.path not in community_paths:
            return self.send_json({"error": "La demo pubblica è in sola lettura e non salva dati personali."}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if self.path == "/api/import/preview":
                limit = 3_000_000
            elif self.path in {"/api/community/message", "/api/community/post"}:
                limit = 1_200_000
            else:
                limit = 100_000
            if length > limit:
                return self.send_json({"error": "Richiesta troppo grande."}, 413)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if self.path in community_paths:
                rules = {
                    "/api/community/profile": ("profile", 8, 600),
                    "/api/community/message": ("message", 15, 60),
                    "/api/community/post": ("post", 5, 600),
                    "/api/community/rating": ("rating", 12, 600),
                    "/api/community/action": ("action", 40, 60),
                }
                bucket, count, window = rules[self.path]
                if not community_rate_allowed(self.client_address[0], bucket, count, window):
                    return self.send_json({"error": "Troppe azioni ravvicinate. Attendi qualche minuto."}, 429)
                if self.path == "/api/community/profile":
                    return self.send_json(save_community_profile(payload), 201)
                if self.path == "/api/community/message":
                    return self.send_json(add_community_message(payload), 201)
                if self.path == "/api/community/post":
                    return self.send_json(add_community_post(payload), 201)
                if self.path == "/api/community/rating":
                    return self.send_json(save_community_rating(payload), 201)
                return self.send_json(update_community_relation(payload))
            if self.path == "/api/restore-local-backup":
                return self.send_json(restore_local_backup(payload))
            if self.path == "/api/import/preview":
                return self.send_json(preview_csv_import(payload))
            if self.path == "/api/import/confirm":
                return self.send_json(confirm_csv_import(str(payload.get("token", ""))), 201)
            if self.path == "/api/journal":
                return self.send_json(add_journal_entry(payload), 201)
            if self.path == "/api/plan":
                return self.send_json(save_plan(payload))
            return self.send_json(save_portfolio(payload))
        except (ValueError, json.JSONDecodeError) as exc:
            if self.path in ({"/api/journal", "/api/import/preview", "/api/import/confirm"} | community_paths) and str(exc):
                return self.send_json({"error": str(exc)}, 400)
            self.send_json({"error": "Dati portafoglio non validi."}, 400)

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/api/journal", "/api/import"}:
            return self.send_json({"error": "Endpoint non trovato."}, 404)
        if DEMO_MODE:
            return self.send_json({"error": "La demo pubblica è in sola lettura."}, 403)
        if parsed.path == "/api/import":
            batch_id = urllib.parse.parse_qs(parsed.query).get("batchId", [""])[0]
            transactions = load_transactions()
            remaining = [item for item in transactions if item.get("batchId") != batch_id]
            if len(remaining) == len(transactions):
                return self.send_json({"error": "Importazione non trovata."}, 404)
            write_transactions(remaining)
            return self.send_json({"deleted": len(transactions) - len(remaining), "total": len(remaining)})
        entry_id = urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
        entries = load_journal()
        remaining = [entry for entry in entries if entry.get("id") != entry_id]
        if len(remaining) == len(entries):
            return self.send_json({"error": "Voce non trovata."}, 404)
        write_journal(remaining)
        self.send_json({"deleted": True})

    def serve_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in ("", "/") else request_path.lstrip("/")
        candidate = (ROOT / "web" / relative).resolve()
        web_root = (ROOT / "web").resolve()
        if web_root not in candidate.parents and candidate != web_root:
            return self.send_error(HTTPStatus.FORBIDDEN)
        if not candidate.is_file():
            candidate = web_root / "index.html"
        body = candidate.read_bytes()
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{mime}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


if __name__ == "__main__":
    DATA_DIR.mkdir(exist_ok=True)
    address = (HOST, PORT)
    print(f"Crypto Radar attivo su http://{address[0]}:{address[1]}")
    print("Premi Ctrl+C per arrestarlo.")
    ThreadingHTTPServer(address, Handler).serve_forever()
