FROM nvcr.io/nvidia/pytorch:24.03-py3

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install GroundingDINO from source
RUN pip install --no-cache-dir groundingdino-py

# Install SAM 2
RUN pip install --no-cache-dir "sam2 @ git+https://github.com/facebookresearch/sam2.git"

# Install Florence-2 via transformers
RUN pip install --no-cache-dir \
    transformers>=4.40.0 \
    einops \
    timm

COPY main.py serve.py ./
COPY localscan ./localscan

# Weights are volume-mounted at /weights; scans and the API token live under /data.
# The container listens on all of its own interfaces, but compose publishes the port to the
# host's loopback only (cv-server/docker-compose.yml), so the API is not on the LAN.
ENV CV_DATA_DIR=/data CV_HOST=0.0.0.0
VOLUME ["/weights", "/data"]

EXPOSE 8000

CMD ["python", "serve.py"]
