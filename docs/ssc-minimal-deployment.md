# Minimal SSC Web Deployment

This deployment runs only the services required by the current browser experience:

- a production-built React frontend served by Caddy;
- the HTTP/SSE MCP Gateway and its persistent MCP stdio server.

The CSV is bundled with both containers. PostgreSQL, MinIO, FastAPI, and the separate model service are intentionally omitted because the current browser workflows do not depend on them. The frontend uses the Gateway health endpoint for its service-status check.

## 1. Create the SSC instance

Use a supported Ubuntu LTS image, the project internal IPv4 network, and a dedicated security group. A 2-vCPU/4-GB instance is sufficient for initial use; 4 vCPU/8 GB leaves more headroom for concurrent Agent Lab runs.

For the private acceptance deployment, allow inbound TCP 22 only from the operator's public IPv4 address (`x.x.x.x/32`). Do not attach the existing default security group and do not expose ports 8080 or 8787.

## 2. Install Docker

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository. Verify the installation:

```bash
sudo docker run --rm hello-world
docker compose version
```

## 3. Transfer the project

From the workstation, run from the repository directory:

```bash
rsync -az \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .venv \
  -e "ssh -i ~/.ssh/SSC_KEY" \
  ./ ubuntu@FLOATING_IP:~/pcm-platform/
```

## 4. Start the web application

On the SSC instance:

```bash
cd ~/pcm-platform
cp .env.ssc.example .env.ssc
sudo docker compose --env-file .env.ssc -f compose.ssc.yml up -d --build
sudo docker compose -f compose.ssc.yml ps
```

The only host listener created by the Compose project is `127.0.0.1:8080`. The Gateway is reachable only from the private Docker network.

## 5. Open the page securely

From the workstation:

```bash
ssh -i ~/.ssh/SSC_KEY \
  -L 8080:127.0.0.1:8080 \
  ubuntu@FLOATING_IP
```

Keep the SSH session open and visit `http://127.0.0.1:8080`. No domain or public web port is required.

## 6. Verify the deployment

```bash
curl http://127.0.0.1:8080/gateway/health
sudo docker compose -f compose.ssc.yml logs --tail=100
```

In the browser, verify dataset loading, dashboard navigation, Twin Lab prediction, what-if analysis, recommendations, and one Agent Lab workflow.

## Public access boundary

Do not change `WEB_BIND_IP` to `0.0.0.0` as a shortcut. Public access should be added only with a domain, automatic HTTPS, access control, Gateway rate limits, and a security group restricted to the required web ports.

