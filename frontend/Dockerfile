FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html ./
COPY src ./src
COPY public ./public
COPY pcm_thermal_storage.csv ./pcm_thermal_storage.csv

ARG VITE_API_BASE_URL=/gateway
ARG VITE_MCP_GATEWAY_URL=/gateway
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_MCP_GATEWAY_URL=${VITE_MCP_GATEWAY_URL}

RUN npm run build

FROM caddy:2-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 8080

