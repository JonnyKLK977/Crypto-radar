FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000 \
    CRYPTO_RADAR_HOST=0.0.0.0 \
    CRYPTO_RADAR_DEMO=1 \
    CRYPTO_RADAR_DATA_DIR=/tmp/crypto-radar

WORKDIR /app
COPY app.py ./
COPY market_fallback.json ./
COPY web ./web

RUN useradd --system --uid 10001 appuser \
    && mkdir -p /tmp/crypto-radar \
    && chown -R appuser:appuser /tmp/crypto-radar /app

USER appuser
EXPOSE 10000
CMD ["python", "app.py"]
