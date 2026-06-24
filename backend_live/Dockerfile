# Portfolio API (**backend_live**) — tunnel / production-style bind.
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends cifs-utils \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data
COPY run.py .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Listen on all interfaces inside the container so host port publishes work.
ENV API_HOST=0.0.0.0
ENV API_PORT=9001
ENV API_RELOAD=false
ENV MEDIA_ROOT=/media/tableau-images

EXPOSE 9001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:9001/health')"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "run.py"]
