FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV USE_MOCK_AGI=1
ENV PIP_INDEX_URL=https://pypi.org/simple

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend /app/backend

EXPOSE 3100
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "3100"]
