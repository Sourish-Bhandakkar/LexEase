# Stage 1: Build the production application
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci || npm install

# Copy application source code
COPY . .

# Build-time argument for custom hosted API base URL (empty defaults to same-origin / reverse proxy)
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Build production static bundle into dist/
RUN npm run build

# Stage 2: Serve production bundle with Nginx
FROM nginx:alpine

# Copy built production assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx SPA and reverse proxy configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose standard HTTP port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
