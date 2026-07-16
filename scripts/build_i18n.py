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
        "Potenziali Crypto": "Potential Cryptos",
        "Assistente Personale": "Personal Assistant",
        "Laboratorio": "Laboratory",
        "Costo operazione": "Transaction Cost",
        "Come usare Costo operazione": "How to use Transaction Cost",
        "Costo operazione: confrontare prima di acquistare o vendere": "Transaction Cost: compare before buying or selling",
        "Fill": "Fill",
        "Fill · copertura": "Fill · coverage",
        "FILL · COPERTURA": "FILL · COVERAGE",
        "1 · Fill": "1 · Fill",
        "Usare l’Assistente Personale": "Using the Personal Assistant",
        "Apri Assistente Personale": "Open Personal Assistant",
        "Cerca una crypto": "Search for a crypto",
        "Scrivi nome, simbolo o rank…": "Type a name, symbol, or rank…",
        "Ordina elenco": "Sort list",
        "Ordina crypto": "Sort cryptos",
        "Per rank": "By rank",
        "Alfabetico": "Alphabetical",
        "Crypto disponibili": "Available cryptos",
        "Nessuna crypto trovata. Prova con nome o simbolo.": "No crypto found. Try a name or symbol.",
        "Caricamento catalogo crypto…": "Loading crypto catalog…",
        "crypto disponibili da CoinMarketCap": "cryptos available from CoinMarketCap",
        "crypto disponibili · catalogo di riserva": "cryptos available · backup catalog",
        "scrivi per restringere la ricerca": "type to narrow the search",
        "Catalogo esteso per aggiungere fino a 30 posizioni.": "Extended catalog for adding up to 30 positions.",
        "Lo storico viene verificato su CoinGecko quando disponibile.": "Historical data is checked on CoinGecko when available.",
        "Gli asset fuori dal campione live usano i campi CoinMarketCap disponibili.": "Assets outside the live sample use the available CoinMarketCap fields.",
        "Prezzi correnti indicativi; operazioni esclusivamente virtuali.": "Indicative current prices; virtual trades only.",
        "La presenza nel catalogo non garantisce una coppia EUR sugli exchange.": "Catalog availability does not guarantee an EUR pair on exchanges.",
        "Catalogo esteso CoinMarketCap: lo score usa soltanto i campi disponibili e non include lo storico completo del campione live.": "Extended CoinMarketCap catalog: the score uses only available fields and does not include the live sample's full history.",
        "Cerca e seleziona una crypto per preparare l’operazione virtuale.": "Search for and select a crypto to prepare the virtual trade.",
        "Seleziona una crypto per la simulazione DCA.": "Select a crypto for the DCA simulation.",
        "Seleziona una crypto da confrontare.": "Select a crypto to compare.",
        "Apri su CoinMarketCap": "Open on CoinMarketCap",
        "di": "of",
        "Come funziona": "How it works",
        "Guida della sezione": "Section guide",
        "Ultime dalle fonti italiane": "Latest from Italian sources",
        "Dalle fonti italiane": "From Italian sources",
        "Criptovaluta.it ↗": "Criptovaluta.it ↗",
        "BeInCrypto Italia ↗": "BeInCrypto Italia ↗",
        "The Crypto Gateway ↗": "The Crypto Gateway ↗",
        "Criptovaluta.it": "Criptovaluta.it",
        "BeInCrypto Italia": "BeInCrypto Italia",
        "The Crypto Gateway": "The Crypto Gateway",
        "Titoli da Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway": "Headlines from Criptovaluta.it, BeInCrypto Italia, and The Crypto Gateway",
        "Le notizie dalle fonti italiane sono momentaneamente non disponibili.": "News from Italian sources is temporarily unavailable.",
        "La Home alterna gli ultimi titoli di Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway. Apri sempre l’articolo originale e separa l’informazione dal punteggio quantitativo.": "The Home page alternates the latest headlines from Criptovaluta.it, BeInCrypto Italia, and The Crypto Gateway. Always open the original article and keep information separate from the quantitative score.",
        "Trending misura attenzione, non qualità. Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway offrono titoli italiani; le notizie non italiane vengono tradotte mostrando anche l’originale. Usa i filtri Portafoglio/POL/ALGO/ADA e apri sempre la fonte.": "Trending measures attention, not quality. Criptovaluta.it, BeInCrypto Italia, and The Crypto Gateway provide Italian-language headlines; non-Italian news is translated while keeping the original visible. Use the Portfolio/POL/ALGO/ADA filters and always open the source.",
        "Titoli pubblicati direttamente in italiano e alternati tra le fonti disponibili. Ogni articolo resta separato dallo score e non costituisce una raccomandazione dell’app.": "Headlines are published directly in Italian and alternated among the available sources. Each article remains separate from the score and is not a recommendation from the app.",
        "I titoli non italiani vengono tradotti automaticamente; l’originale resta visibile sotto. Le notizie forniscono contesto e non modificano lo score.": "Non-Italian headlines are translated automatically; the original remains visible below. News provides context and does not change the score.",
        "posizioni": "positions", "eventi": "events", "futuri": "upcoming", "official": "official", "secondary": "confirmed", "unverified": "unverified", "high": "high", "medium": "medium", "low": "low", "impatto": "impact", "punti": "points", "posizione maggiore": "largest position",
        "Layer 1": "Layer 1", "Layer 2": "Layer 2", "Altro / da verificare": "Other / to verify",
    },
    "es": {
        "Potenziali Crypto": "Criptomonedas potenciales",
        "Assistente Personale": "Asistente Personal",
        "Laboratorio": "Laboratorio",
        "Costo operazione": "Coste de la operación",
        "Come usare Costo operazione": "Cómo usar Coste de la operación",
        "Costo operazione: confrontare prima di acquistare o vendere": "Coste de la operación: compara antes de comprar o vender",
        "Fill": "Fill",
        "Fill · copertura": "Fill · cobertura",
        "FILL · COPERTURA": "FILL · COBERTURA",
        "1 · Fill": "1 · Fill",
        "Usare l’Assistente Personale": "Usar el Asistente Personal",
        "Apri Assistente Personale": "Abrir Asistente Personal",
        "Cerca una crypto": "Buscar una criptomoneda",
        "Scrivi nome, simbolo o rank…": "Escribe un nombre, símbolo o ranking…",
        "Ordina elenco": "Ordenar lista",
        "Ordina crypto": "Ordenar criptomonedas",
        "Per rank": "Por ranking",
        "Alfabetico": "Alfabético",
        "Crypto disponibili": "Criptomonedas disponibles",
        "Nessuna crypto trovata. Prova con nome o simbolo.": "No se encontró ninguna criptomoneda. Prueba con un nombre o símbolo.",
        "Caricamento catalogo crypto…": "Cargando catálogo de criptomonedas…",
        "crypto disponibili da CoinMarketCap": "criptomonedas disponibles en CoinMarketCap",
        "crypto disponibili · catalogo di riserva": "criptomonedas disponibles · catálogo de respaldo",
        "scrivi per restringere la ricerca": "escribe para limitar la búsqueda",
        "Catalogo esteso per aggiungere fino a 30 posizioni.": "Catálogo ampliado para añadir hasta 30 posiciones.",
        "Lo storico viene verificato su CoinGecko quando disponibile.": "El historial se verifica en CoinGecko cuando está disponible.",
        "Gli asset fuori dal campione live usano i campi CoinMarketCap disponibili.": "Los activos fuera de la muestra en vivo utilizan los campos disponibles de CoinMarketCap.",
        "Prezzi correnti indicativi; operazioni esclusivamente virtuali.": "Precios actuales indicativos; operaciones exclusivamente virtuales.",
        "La presenza nel catalogo non garantisce una coppia EUR sugli exchange.": "La presencia en el catálogo no garantiza un par EUR en los exchanges.",
        "Catalogo esteso CoinMarketCap: lo score usa soltanto i campi disponibili e non include lo storico completo del campione live.": "Catálogo ampliado de CoinMarketCap: la puntuación usa solo los campos disponibles y no incluye el historial completo de la muestra en vivo.",
        "Cerca e seleziona una crypto per preparare l’operazione virtuale.": "Busca y selecciona una criptomoneda para preparar la operación virtual.",
        "Seleziona una crypto per la simulazione DCA.": "Selecciona una criptomoneda para la simulación DCA.",
        "Seleziona una crypto da confrontare.": "Selecciona una criptomoneda para comparar.",
        "Apri su CoinMarketCap": "Abrir en CoinMarketCap",
        "di": "de",
        "Come funziona": "Cómo funciona",
        "Guida della sezione": "Guía de la sección",
        "Ultime dalle fonti italiane": "Últimas noticias de fuentes italianas",
        "Dalle fonti italiane": "De fuentes italianas",
        "Criptovaluta.it ↗": "Criptovaluta.it ↗",
        "BeInCrypto Italia ↗": "BeInCrypto Italia ↗",
        "The Crypto Gateway ↗": "The Crypto Gateway ↗",
        "Criptovaluta.it": "Criptovaluta.it",
        "BeInCrypto Italia": "BeInCrypto Italia",
        "The Crypto Gateway": "The Crypto Gateway",
        "Titoli da Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway": "Titulares de Criptovaluta.it, BeInCrypto Italia y The Crypto Gateway",
        "Le notizie dalle fonti italiane sono momentaneamente non disponibili.": "Las noticias de fuentes italianas no están disponibles temporalmente.",
        "La Home alterna gli ultimi titoli di Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway. Apri sempre l’articolo originale e separa l’informazione dal punteggio quantitativo.": "La página de inicio alterna los últimos titulares de Criptovaluta.it, BeInCrypto Italia y The Crypto Gateway. Abra siempre el artículo original y mantenga la información separada de la puntuación cuantitativa.",
        "Trending misura attenzione, non qualità. Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway offrono titoli italiani; le notizie non italiane vengono tradotte mostrando anche l’originale. Usa i filtri Portafoglio/POL/ALGO/ADA e apri sempre la fonte.": "Las tendencias miden la atención, no la calidad. Criptovaluta.it, BeInCrypto Italia y The Crypto Gateway ofrecen titulares en italiano; las noticias no italianas se traducen manteniendo visible el original. Use los filtros Cartera/POL/ALGO/ADA y abra siempre la fuente.",
        "Titoli pubblicati direttamente in italiano e alternati tra le fonti disponibili. Ogni articolo resta separato dallo score e non costituisce una raccomandazione dell’app.": "Titulares publicados directamente en italiano y alternados entre las fuentes disponibles. Cada artículo permanece separado de la puntuación y no constituye una recomendación de la aplicación.",
        "I titoli non italiani vengono tradotti automaticamente; l’originale resta visibile sotto. Le notizie forniscono contesto e non modificano lo score.": "Los titulares que no están en italiano se traducen automáticamente; el original permanece visible debajo. Las noticias aportan contexto y no modifican la puntuación.",
        "posizioni": "posiciones", "eventi": "eventos", "futuri": "próximos", "official": "oficial", "secondary": "confirmada", "unverified": "sin verificar", "high": "alto", "medium": "medio", "low": "bajo", "impatto": "impacto", "punti": "puntos", "posizione maggiore": "posición mayor",
        "Layer 1": "Capa 1", "Layer 2": "Capa 2", "Altro / da verificare": "Otro / por verificar",
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
