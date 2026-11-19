# SafeRoute Naija

A safety, security and road-hazard app for travellers, drivers and security personnel.
It runs on your own VPS with a built-in SQLite database: no Supabase or other outside database is needed.

- **Server:** Node.js + Express (`server.js`)
- **Database:** SQLite, one file at `data/saferoute.db` (photos in `data/uploads/`)
- **App:** installable web app (PWA) in `public/`, with Leaflet maps, live GPS, sound and voice alerts
- **Risk formula:** `shared/risk.js`, used by both the server and the phone

## What is inside

| Who | Can do |
| --- | --- |
| Traveller / driver | Live GPS on satellite map, risk score, sound + voice warnings, Tourist Mode, Driver Mode, report hazards with photo, confirm or clear reports, nearest police/hospital/mechanic, SOS |
| Security (verified) | SOS feed with live location, mark incidents "responding" or "cleared", confirm reports as Official, post advisories that publish at once |
| Moderator | Approve, reject, re-type or remove reports, add places |
| Admin | Everything above, plus verify security accounts, change roles, ban users, add places and settlement zones, tune every risk weight and rule |

## Run it on your computer (Windows PowerShell)

```powershell
cd saferoute
npm install
copy .env.example .env      # then edit .env: set ADMIN_EMAIL and ADMIN_PASSWORD, and COOKIE_SECURE=false for local testing
npm run seed-demo           # optional: sample data for Owerri to Port Harcourt
npm start
```

Open http://localhost:3060 and sign in with the admin email and password from `.env`.
GPS works on `localhost`. On other addresses browsers only allow GPS over HTTPS.

## Deploy on your Hostinger VPS

Same pattern as BookVault and Engineeria.

```bash
# 1. Put the code on the server (via GitHub, or upload the zip)
cd /var/www
git clone https://github.com/<you>/saferoute.git saferoute     # or unzip saferoute.zip here
cd /var/www/saferoute

# 2. Install and configure
npm install --omit=dev
cp .env.example .env
nano .env                    # set ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD; keep COOKIE_SECURE=true

# 3. Start with PM2
pm2 start ecosystem.config.js
pm2 save

# 4. Nginx + HTTPS (point your domain or subdomain's A record at the VPS first)
sudo cp nginx-saferoute.conf /etc/nginx/sites-available/saferoute
sudo nano /etc/nginx/sites-available/saferoute          # put your domain in server_name
sudo ln -s /etc/nginx/sites-available/saferoute /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

The app listens on port **3060**. Change `PORT` in `.env` if another app already uses it.

If `npm install` fails on `better-sqlite3`, install the build tools once and retry:
`sudo apt install -y build-essential python3`.

### Updating later

```bash
cd /var/www/saferoute && git pull && npm install --omit=dev && pm2 restart saferoute
```

The `data/` folder and `.env` are in `.gitignore`, so updates never overwrite your database or settings.

### Backups

Everything lives in `data/`. Back it up with:

```bash
sqlite3 /var/www/saferoute/data/saferoute.db ".backup '/root/backups/saferoute-$(date +%F).db'"
tar czf /root/backups/saferoute-uploads-$(date +%F).tgz -C /var/www/saferoute/data uploads
```

(`sudo apt install sqlite3` if the command is missing.) A daily cron job running these two lines is enough to start.

## First steps after going live

1. Sign in as admin. Open **Admin** and delete the demo places and zones (they end in "(demo)"), or skip `seed-demo` on the server.
2. Add real places for your first corridor: police divisions, FRSC, hospitals and clinics, mechanics, fuel stations (**Admin → Add place**, then tap the map).
3. Add settlement zones (urban, peri-urban, forest stretch) so the base risk is right.
4. Make one or two trusted people **moderators**.
5. Ask security contacts to register and tick "I am security personnel"; verify them under **Admin → Security verification** after checking their ID.

## API (for a future WhatsApp bot or partner apps)

`GET /api/risk?lat=5.16&lng=6.87&hour=22` returns the score, level, zone and nearest security post for any point.

## Limits of a web app

- Alerts only run while the app is open on screen. Driver Mode keeps the screen awake where the phone allows it.
- For alerts with the screen off, wrap this app with Capacitor and add a background-location plugin (Phase 2 in the blueprint).
- Map imagery comes from Esri (satellite) and OpenStreetMap (street). Both are free for light use. Move to a paid tile plan (for example Mapbox or MapTiler) when traffic grows.
