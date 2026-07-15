"""Build local UI translation dictionaries from the Italian interface.

The generated JSON files are shipped with the app. No personal browser data is
sent to a translation service while Crypto Radar is being used.
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
SPLIT = "<<<CR_SPLIT>>>"
MANUAL_OVERRIDES = {
    "en": {
        "Ultime da Criptovaluta.it": "Latest from Criptovaluta.it",
        "Apri Criptovaluta.it ↗": "Open Criptovaluta.it ↗",
        "La Home mostra gli ultimi titoli di Criptovaluta.it. Apri sempre la fonte e separa l’informazione dal punteggio quantitativo.": "The Home page shows the latest headlines from Criptovaluta.it. Always open the source and keep information separate from the quantitative score.",
        "Trending misura attenzione, non qualità. Criptovaluta.it offre titoli italiani; le altre notizie sono tradotte mostrando anche l’originale. Usa i filtri Portafoglio/POL/ALGO/ADA e apri sempre la fonte.": "Trending measures attention, not quality. Criptovaluta.it provides Italian-language headlines; other news is translated while keeping the original visible. Use the Portfolio/POL/ALGO/ADA filters and always open the source.",
    },
    "es": {
        "Ultime da Criptovaluta.it": "Lo último de Criptovaluta.it",
        "Apri Criptovaluta.it ↗": "Abrir Criptovaluta.it ↗",
        "La Home mostra gli ultimi titoli di Criptovaluta.it. Apri sempre la fonte e separa l’informazione dal punteggio quantitativo.": "La página de inicio muestra los últimos titulares de Criptovaluta.it. Abra siempre la fuente y mantenga la información separada de la puntuación cuantitativa.",
        "Trending misura attenzione, non qualità. Criptovaluta.it offre titoli italiani; le altre notizie sono tradotte mostrando anche l’originale. Usa i filtri Portafoglio/POL/ALGO/ADA e apri sempre la fonte.": "Las tendencias miden la atención, no la calidad. Criptovaluta.it ofrece titulares en italiano; las demás noticias se traducen manteniendo visible el original. Use los filtros Cartera/POL/ALGO/ADA y abra siempre la fuente.",
    },
}


def clean(value: str) -> str:
    return " ".join(html.unescape(value).split()).strip()


class SourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.skip = 0
        self.values: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.skip += 1
        for key, value in attrs:
            if key in {"placeholder", "title", "aria-label"} and value:
                self.add(value)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.add(data)

    def add(self, value: str) -> None:
        value = clean(value)
        if value and re.search(r"[A-Za-zÀ-ÿ]", value):
            self.values.add(value)


def javascript_phrases() -> set[str]:
    source = (WEB / "app.js").read_text(encoding="utf-8")
    values: set[str] = set()
    patterns = [r'"((?:\\.|[^"\\])*)"', r"'((?:\\.|[^'\\])*)'", r"`((?:\\.|[^`\\])*)`"]
    for pattern in patterns:
        for match in re.finditer(pattern, source, re.S):
            value = clean(match.group(1).replace("\\n", " ").replace("\\'", "'").replace('\\"', '"'))
            if not (3 <= len(value) <= 450) or not re.search(r"[A-Za-zÀ-ÿ]", value):
                continue
            if any(token in value for token in ("<", ">", "${", "/api/", "querySelector", "cryptoRadar", "data-", "rgba(", "linear-gradient")):
                continue
            if re.fullmatch(r"[A-Za-z0-9_.:/#-]+", value) and " " not in value:
                continue
            values.add(value)
    return values


def collect_sources() -> list[str]:
    parser = SourceParser()
    parser.feed((WEB / "index.html").read_text(encoding="utf-8"))
    parser.values.update(javascript_phrases())
    protected = {"Crypto Radar", "CoinGecko", "Coinbase", "Kraken", "Bitvavo", "Bitcoin", "Ethereum", "POL", "ALGO", "ADA", "BTC", "ETH", "MiCA", "ESMA", "Consob", "NFT", "DeFi", "DCA", "VWAP", "Execution Lab", "Risk Engine"}
    return sorted(value for value in parser.values if value not in protected)


def batches(values: list[str], maximum: int = 3200):
    batch: list[str] = []
    length = 0
    for value in values:
        extra = len(value) + len(SPLIT) + 2
        if batch and length + extra > maximum:
            yield batch
            batch, length = [], 0
        batch.append(value)
        length += extra
    if batch:
        yield batch


def translate_batch(values: list[str], target: str) -> list[str]:
    joined = f"\n{SPLIT}\n".join(values)
    params = urllib.parse.urlencode({"client": "gtx", "sl": "it", "tl": target, "dt": "t", "q": joined})
    request = urllib.request.Request(f"https://translate.googleapis.com/translate_a/single?{params}", headers={"User-Agent": "CryptoRadar-i18n-builder/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    translated = "".join(part[0] for part in payload[0])
    result = [clean(item) for item in translated.split(SPLIT)]
    if len(result) != len(values):
        raise RuntimeError(f"Translation split mismatch: {len(values)} sources, {len(result)} results")
    return result


def build(target: str) -> None:
    sources = collect_sources()
    destination = WEB / f"i18n-{target}.json"
    try:
        existing = json.loads(destination.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        existing = {}
    output: dict[str, str] = {source: existing[source] for source in sources if source in existing}
    missing = [source for source in sources if source not in output]
    all_batches = list(batches(missing))
    for index, batch in enumerate(all_batches, 1):
        for attempt in range(3):
            try:
                translated = translate_batch(batch, target)
                output.update(zip(batch, translated))
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1.5 * (attempt + 1))
        print(f"{target}: batch {index}/{len(all_batches)}")
        time.sleep(0.12)
    output = {source: value.replace("Criptocurrency.it", "Criptovaluta.it") for source, value in output.items()}
    output.update(MANUAL_OVERRIDES.get(target, {}))
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {destination} ({len(output)} entries)")


if __name__ == "__main__":
    build("en")
    build("es")
