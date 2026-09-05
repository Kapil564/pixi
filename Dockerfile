FROM node:22-bullseye-slim

WORKDIR /app

# Install build tools for native node modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Copy package configurations
COPY package.json pnpm-workspace.yaml ./

# Install dependencies (generating fresh platform-specific binaries for Linux container)
RUN pnpm install

# Copy application source code
COPY . .

# Build assets
RUN pnpm build

CMD ["pnpm", "build"]
