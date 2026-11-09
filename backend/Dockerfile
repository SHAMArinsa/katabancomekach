FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN useradd --create-home appuser
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN mkdir -p uploads private_uploads && chown -R appuser /app
USER appuser
EXPOSE 8000
# Render (and most PaaS) inject $PORT; default to 8000 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
