# Cloudflare Free — WAF, DDoS, bot mitigation & Israel-only geo-block

Puts Cloudflare's free edge in front of the IONOS VPS so the API is protected by
Cloudflare's DDoS/bot protection and only reachable from **Israel** (plus your
dev IPs). The origin is locked so the geo rule can't be bypassed.

```
 client → Cloudflare edge (WAF + geo-block)  →  Caddy (TLS, real-IP)  →  Node API :8080
```

## 1. Add the site to Cloudflare (one-time)
1. Create a free Cloudflare account, **Add a site**, enter your domain.
2. Cloudflare shows two **nameservers** — set them at your domain registrar.
   Wait for "Active" (minutes to a couple of hours).

## 2. DNS — proxied A record
- DNS → **Add record**: `A`, name `api` (→ `api.yourdomain.com`), IPv4 = the
  **VPS public IP**, **Proxy status = Proxied (orange cloud)**. The orange cloud
  is what routes traffic through the WAF and hides the origin IP.

## 3. TLS — Full (strict) + Origin certificate
1. SSL/TLS → Overview → mode **Full (strict)**.
2. SSL/TLS → **Origin Server** → **Create Certificate** (default RSA, 15 years).
   Save the certificate to `/etc/caddy/origin.pem` and the private key to
   `/etc/caddy/origin.key` on the VPS (the `tls` line in `deploy/Caddyfile` points
   at these). `chmod 600 /etc/caddy/origin.key`.
3. SSL/TLS → Edge Certificates → turn on **Always Use HTTPS**.

## 4. The geo-block — a WAF custom rule
Security → **WAF** → **Custom rules** → **Create rule**:
- **Field/expression** (use the expression editor):
  ```
  (ip.geoip.country ne "IL") and not (ip.src in {203.0.113.7 198.51.100.22})
  ```
  Replace the two example IPs with **your dev/office IPs** (space-separated inside
  the braces) so you can reach the API from outside Israel. Drop the `and not (...)`
  clause if you don't need any exceptions.
- **Action: Block**. Deploy.

Now every request not from Israel (and not from an allow-listed dev IP) is blocked
at Cloudflare's edge before it ever reaches the VPS.

## 5. Free bot/DDoS toggles (already strong, confirm them)
- Security → Bots → **Bot Fight Mode: On**.
- Security → DDoS → the free managed L7 DDoS ruleset is on by default.
- (Optional) Security → Settings → Security Level: **High**; enable
  **Under Attack Mode** only during an actual incident (it challenges every
  visitor and will disrupt normal players).

## 6. Lock the origin at the host firewall (defense in depth)
Cloudflare geo-blocking is only effective if attackers can't hit the VPS IP
directly. `deploy/Caddyfile` already aborts non-Cloudflare connections, but also
close it at the kernel with `ufw` — allow SSH + only Cloudflare's ranges on 443:
```bash
ufw default deny incoming
ufw allow OpenSSH
for cidr in 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
            141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
            197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
            104.24.0.0/14 172.64.0.0/13 131.0.72.0/22; do
  ufw allow from "$cidr" to any port 443 proto tcp
done
ufw enable
```
(Re-check the ranges at https://www.cloudflare.com/ips/ — they change rarely.)

## 7. Verify
- From an Israeli IP (or a dev IP): `curl https://api.yourdomain.com/healthz` →
  `{"ok":true}`.
- From a non-IL, non-allow-listed IP (e.g. a VPN exit elsewhere): the request is
  **blocked by Cloudflare** (1020 / "not available in your region").
- `curl https://<VPS-IP>/healthz` directly (bypassing Cloudflare) → refused
  (Caddy `abort` and/or ufw).

> ⚠️ Geo-blocking to Israel means your participants must be in Israel (fine for a
> local field game) and that YOU need a dev-IP exception (or a CF login) to reach
> the API from elsewhere. Cloudflare's country is IP-based (GeoIP), so a player on
> a foreign VPN/eSIM could be blocked — keep that in mind for edge cases.
