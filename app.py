"""Crypto Radar - local, dependency-free web server."""

from __future__ import annotations

import json
import html
import csv
import hashlib
import io
import mimetypes
import os
import time
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
COINGECKO = "https://api.coingecko.com/api/v3"
COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/"
CRIPTOVALUTA_RSS = "https://www.criptovaluta.it/feed/"
PORT = int(os.environ.get("PORT", os.environ.get("CRYPTO_RADAR_PORT", "8765")))
HOST = os.environ.get("CRYPTO_RADAR_HOST", "127.0.0.1")
DEMO_MODE = os.environ.get("CRYPTO_RADAR_DEMO", "0").strip().lower() in {"1", "true", "yes", "on"}

DEFAULT_PORTFOLIO = {
    "currency": "eur",
    "holdings": [
        {"id": "polygon-ecosystem-token", "symbol": "POL", "amount": 0, "avgCost": 0},
        {"id": "algorand", "symbol": "ALGO", "amount": 0, "avgCost": 0},
        {"id": "cardano", "symbol": "ADA", "amount": 0, "avgCost": 0},
    ],
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
    "targets": [
        {"id": "bitcoin", "symbol": "BTC", "target": 0},
        {"id": "ethereum", "symbol": "ETH", "target": 0},
        {"id": "polygon-ecosystem-token", "symbol": "POL", "target": 0},
        {"id": "algorand", "symbol": "ALGO", "target": 0},
        {"id": "cardano", "symbol": "ADA", "target": 0},
    ],
}

_cache: dict[str, tuple[float, object]] = {}
_import_previews: dict[str, dict] = {}


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_portfolio() -> dict:
    if not PORTFOLIO_FILE.exists():
        return DEFAULT_PORTFOLIO.copy()
    try:
        data = json.loads(PORTFOLIO_FILE.read_text(encoding="utf-8"))
        if not isinstance(data.get("holdings"), list):
            raise ValueError("holdings non valido")
        existing = {item.get("id") for item in data["holdings"]}
        for required in DEFAULT_PORTFOLIO["holdings"]:
            if required["id"] not in existing:
                data["holdings"].append(required.copy())
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
    existing = {item.get("id") for item in data["targets"]}
    for required in DEFAULT_PLAN["targets"]:
        if required["id"] not in existing:
            data["targets"].append(required.copy())
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
    allowed = {item["id"]: item["symbol"] for item in DEFAULT_PLAN["targets"]}
    target_values = {}
    for item in payload.get("targets", []):
        coin_id = str(item.get("id", ""))
        if coin_id not in allowed:
            continue
        try:
            target_values[coin_id] = min(100.0, max(0.0, float(item.get("target", 0))))
        except (TypeError, ValueError):
            target_values[coin_id] = 0.0
    cleaned["targets"] = [
        {"id": coin_id, "symbol": symbol, "target": target_values.get(coin_id, 0.0)}
        for coin_id, symbol in allowed.items()
    ]
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


def load_translation_cache() -> dict[str, str]:
    try:
        data = json.loads(TRANSLATIONS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, json.JSONDecodeError):
        return {}


def translate_title(title: str) -> str:
    params = urllib.parse.urlencode({"q": title[:450], "langpair": "en|it", "mt": "1"})
    url = f"https://api.mymemory.translated.net/get?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "CryptoRadar/0.2"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        translated = html.unescape(str(payload.get("responseData", {}).get("translatedText", ""))).strip()
        return translated if translated and translated.lower() != title.lower() else title
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return title


def translate_news() -> dict[str, str]:
    articles = load_news()[:25]
    cache = load_translation_cache()
    english_titles = [article["title"] for article in articles if article.get("sourceLanguage") == "en"]
    missing = [title for title in english_titles if title not in cache]
    if missing:
        with ThreadPoolExecutor(max_workers=4) as executor:
            jobs = {executor.submit(translate_title, title): title for title in missing}
            for job in as_completed(jobs):
                title = jobs[job]
                try:
                    cache[title] = job.result()
                except Exception:
                    cache[title] = title
        DATA_DIR.mkdir(exist_ok=True)
        temp = TRANSLATIONS_FILE.with_suffix(".tmp")
        temp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(TRANSLATIONS_FILE)
    return {title: cache.get(title, title) for title in english_titles}


class Handler(BaseHTTPRequestHandler):
    server_version = "CryptoRadar/0.1"

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                return self.send_json({"ok": True, "time": int(time.time()), "demo": DEMO_MODE})
            if parsed.path == "/api/config":
                return self.send_json({"demo": DEMO_MODE, "writesEnabled": not DEMO_MODE})
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
                return self.send_json({"data": data, "asOf": int(time.time())})
            if parsed.path == "/api/trending":
                data = coingecko_get("/search/trending", {}, ttl=600)
                return self.send_json(data)
            if parsed.path == "/api/news":
                return self.send_json({"articles": load_news(), "asOf": int(time.time())})
            if parsed.path == "/api/news-translations":
                return self.send_json({"translations": translate_news(), "language": "it"})
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
                allowed_ids = {item["id"] for item in DEFAULT_PLAN["targets"]}
                if coin_id not in allowed_ids:
                    return self.send_json({"error": "Crypto non supportata dal simulatore."}, 400)
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
        if self.path not in ("/api/portfolio", "/api/plan", "/api/journal", "/api/import/preview", "/api/import/confirm"):
            return self.send_json({"error": "Endpoint non trovato."}, 404)
        if DEMO_MODE:
            return self.send_json({"error": "La demo pubblica è in sola lettura e non salva dati personali."}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            limit = 3_000_000 if self.path == "/api/import/preview" else 100_000
            if length > limit:
                return self.send_json({"error": "Richiesta troppo grande."}, 413)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
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
            if self.path in {"/api/journal", "/api/import/preview", "/api/import/confirm"} and str(exc):
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
