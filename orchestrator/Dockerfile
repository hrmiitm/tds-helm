# orchestrator/Dockerfile — Lightweight Studio Universal Hub Image
# Target resource footprint: <= 0.5 CPU, <= 256 MiB RAM. No Python/Jupyter/VS Code stacks.
FROM node:22-alpine

# Set non-root working environment
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy compiled orchestrator dist
COPY dist/ ./dist/

# Expose Gateway & Control Port
EXPOSE 8080

# Environment defaults
ENV NODE_ENV=production \
    PORT=8080 \
    BIND_ADDRESS=0.0.0.0

# Run as node user (UID 1000)
USER node

ENTRYPOINT ["node", "dist/server.js"]
