# Public SSC Web Deployment

The public profile exposes the PCM web application through Caddy on ports 80 and 443. Caddy obtains and renews a public TLS certificate automatically. The MCP Gateway remains on the private Docker network and is reachable only through the same-origin `/gateway` proxy.

The initial public hostname is `pcm.130-238-27-71.sslip.io`, which resolves to the SSC floating IP through sslip.io. A personally controlled domain can replace it later without changing the application architecture.

## Security-group rules

Add these inbound IPv4 rules to `pcm-platform-private`:

```text
HTTP   TCP 80   0.0.0.0/0
HTTPS  TCP 443  0.0.0.0/0
```

Keep SSH restricted to the operator IP. Do not expose 8080 or 8787.

## Deploy

After synchronizing the repository to the server:

```bash
cd ~/pcm-platform
cp .env.ssc.public.example .env.ssc.public

sudo docker compose \
  --env-file .env.ssc.public \
  -f compose.ssc.public.yml \
  config --quiet

sudo docker compose \
  --env-file .env.ssc.public \
  -f compose.ssc.public.yml \
  up -d --build
```

## Verify

```bash
sudo docker compose -f compose.ssc.public.yml ps
sudo docker compose -f compose.ssc.public.yml logs web --tail=100
curl -I https://pcm.130-238-27-71.sslip.io
curl https://pcm.130-238-27-71.sslip.io/gateway/health
```

The public profile permits at most two active Agent Lab workflows and six workflow submissions per source IP per minute. These in-memory limits protect a public research demonstration from accidental overload; they are not a substitute for a production API gateway or authenticated quota service.

