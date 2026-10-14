FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.11.11 PyJWT==2.10.1
COPY app.py .
EXPOSE 8080
CMD ["python", "-u", "app.py"]
