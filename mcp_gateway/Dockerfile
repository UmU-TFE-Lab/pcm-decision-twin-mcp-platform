FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY mcp_gateway ./mcp_gateway
COPY mcp_server ./mcp_server
COPY src ./src
COPY release_manifest.json pcm_thermal_storage.csv ./

RUN mkdir -p /app/.runtime/mcp-runs

ENV MCP_GATEWAY_HOST=0.0.0.0
ENV MCP_GATEWAY_PORT=8787
ENV PCM_DATASET_PATH=/app/pcm_thermal_storage.csv

EXPOSE 8787

CMD ["node", "mcp_gateway/server.mjs"]
