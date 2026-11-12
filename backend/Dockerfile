FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=7860

WORKDIR /app

# Create non-root user (UID 1000 works across Hugging Face Spaces, Render, and Koyeb)
RUN useradd -m -u 1000 appuser

COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

COPY --chown=appuser:appuser . /app

RUN mkdir -p /app/app/logs /app/app/uploads /app/app/outputs /app/logs /app/uploads /app/outputs && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 7860

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
