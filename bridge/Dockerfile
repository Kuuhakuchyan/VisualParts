FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout 120 --retries 10 -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY bridge.py .
CMD ["python", "bridge.py"]
