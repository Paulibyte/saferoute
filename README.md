# SafeRoute Naija

A safety, security and road-hazard app for travellers, drivers and security personnel.
It runs on your own VPS with a built-in SQLite database: no Supabase or other outside database is needed.

- **Server:** Node.js + Express (`server.js`)
- **Database:** SQLite, one file at `data/saferoute.db` (photos in `data/uploads/`)
- **App:** installable web app (PWA) in `public/`, with Leaflet maps, live GPS, sound and voice alerts
- **Risk formula:** `shared/risk.js`, used by both the server and the phone

## What is inside (version 2)

**Risk intelligence.** Every place gets a *threat level* (Low, Moderate, High, Severe) and, separately, a *confidence level* (Low, Moderate, High), with plain-language reasons and a recommended action. It weighs:
recent incidents (by distance, how recent and how reliable), incident frequency over 30 days and a year, the time-of-day pattern of past incidents, road conditions, weather (Open-Meteo, free),
verified security posts and whether anyone has confirmed they are operating, security response in progress, and community confirmations. Night only raises the rating where there is threat evidence.

**SafeRoute Journey Planner.** Enter a destination and compare up to three routes: time, distance, worst stretch, kilometres of high risk, incidents and road hazards along each,
dangerous stretches with reasons, safer places to stop, hospitals and police along the way, rain forecast and a suggested departure time. Routes are only ever described as relatively lower or higher reported risk.
Start the trip for spoken warnings before each risky stretch, or share it with your Safe Circle.

**Emergency Connect (SOS).** Press-and-hold SOS → GPS captured → reference number (e.g. SR-261120-4F7K) → Safe Circle texted with a live-location link (when SMS is set up) →
verified responders near you get a device notification (and SMS if they opt in) → location updates every 15 s → responders mark Acknowledged / Responding / On scene / Closed, which the user and their circle can see →
cancel needs a PIN or password. An optional *duress PIN* makes the SOS look cancelled while it stays active and warns responders. One-tap fallbacks: call 112, SMS from your own phone, WhatsApp.
The app tells users plainly that an SOS through SafeRoute does not by itself guarantee that emergency personnel received it.

**Reporting.** 16 categories (kidnapping, armed robbery, armed attack, civil unrest, security operations, road accident, flooding, bridge failure, road blockage, fuel hazard, fire, building collapse,
dangerous road conditions, medical emergency, accident blackspot, official advisory). Each report records ongoing, injured, trapped, people affected, when it happened, how the reporter knows, and photo or video.
Statuses: Unverified → Under investigation → Verified → Resolved/expired (or Rejected). Each report has a confidence score built from the reporter's track record, independent similar reports,
and community confirmations (*I can confirm / Still happening / Resolved / Seems inaccurate*) weighted by how close the person was, how recent, how independent and how reliable they are.
**A single unverified report about crime is never shown publicly** until it is corroborated or verified.

| Who | Can do |
| --- | --- |
| Traveller / driver | Risk and confidence where they are, Journey Planner, voice alerts, Driver Mode, reports, confirmations, Safe Circle, live sharing, SOS |
| Security (verified) | SOS feed with live trail, status updates, confirm reports as Official, post advisories, confirm posts are operating, duty location for nearby alerts |
| Moderator | Review queue with confidence breakdown: verify, investigate, reject, resolve, correct category; add places |
| Admin | Everything above, plus agencies, verify security accounts, roles, trusted contributors, bans, places, area types, every weight and rule, audit log |
| Agency supervisor | Verify officers of their own agency |
| Fleet manager | Fleet dashboard: trips, alerts, vehicles, drivers, alert rules |

## New in version 3

**Safe Circle family protection and Safe Journey Check-in.** Start a journey (with or without a planned route) and set an expected arrival time.
Your circle is told when you set off, gets a live map link, is alerted if you go more than 2 km off the planned route (you can mark a planned detour), and is told when you arrive.
Optional check-ins during the journey (every 30 min / 1 h / 2 h). If arrival is not confirmed in time: first a reminder to you, then — after 20 minutes more — a *missed check-in* alert to your circle,
worded as **not an SOS**, with the last location update. Lost signal alone is never treated as an emergency.

**Community security alerts.** Each person chooses: alerts on/off, "where I am" (approximate location kept only 6 hours), radius, categories, verified-only, and up to five saved places (home, work, family).
An alert goes out when a report becomes public (corroborated or verified) and again if it is later verified — never for a single unconfirmed crime report. Limited to 10 per person per hour.

**Offline safety packs and queued reports.** Save a route or your area: reports, help places, area data and emergency contacts are stored on the phone with the time they were collected; expired reports drop out automatically.
Map images already viewed are kept (up to 1,500 tiles). Reports made without network are saved on the phone and sent automatically when the connection returns.

**Emergency facilities directory (Help tab).** Police, FRSC, NSCDC, military, community security, SEMA, fire service, ambulance, hospitals, clinics, mechanics, vulcanisers, fuel —
with phone, opening hours, address and the date the listing was last verified. Anyone can suggest a correction or a missing place; moderators approve; staff can verify listings.

**Incident heatmap.** Verified incidents by area, category, period (30/90/365 days) and time of day. The public sees areas only (5 km cells, areas with fewer than 3 incidents hidden); staff and fleet managers see a finer grid.

**Safety briefing.** A plain-language summary of each planned journey, written by the app from the actual reports (no external AI, no cost). It never invents threats and says so.

**Security agency portal.** Agencies (Police, FRSC, NSCDC, SEMA, fire, ambulance, community security…) are set up by the admin. Officers pick their agency when registering; agency supervisors verify their own officers.
SOS and reports can be assigned, responders share internal notes, and official advisories show the agency's name.

**Reliable SOS notifications.** Every push, SMS and call is tracked with retries and delivery receipts (phone displayed it / Twilio delivered it), shown to the person and to responders.
If nobody acknowledges an SOS in 3 minutes the alert widens (and phones ring, if voice calls are on); after 10 minutes every verified responder and admin is alerted. Everyone also has an in-app alert inbox (🔔).

**Fleet safety.** A transport or logistics company creates a fleet and shares an invite code with drivers. Managers see vehicles on trips, route risk, off-route alerts, unscheduled stops (default 15 min away from known stops),
lost signal, overdue arrival, driver SOS and driver reports, plus vehicles, drivers and alert rules.

**Security hardening.** Two-step verification (authenticator app + backup codes) required for staff; login throttling; stronger passwords; device list with remote sign-out;
CSRF protection and a strict content-security policy; rate limits; an audit log of every official action; uploaded photos checked by their real content, GPS/camera data removed, and evidence
visible only to staff and the reporter until a moderator publishes it (videos stay staff-only).

### Privacy notes
Live locations are shared only while the person shares, journeys or has an active SOS, and only with people who have the link or are in their circle. "Alerts where I am" keeps an approximate location for 6 hours and can be turned off.
Track points are deleted after 30 days, notifications after 60 days. Before public launch, have a data-protection assessment done under the Nigeria Data Protection Act 2023 and publish a privacy notice.

### Scaling later
SQLite comfortably handles thousands of users on one server. When traffic grows (many tens of thousands of active users, or several servers), move to PostgreSQL with PostGIS.
For alerts with the screen off, wrap the app with Capacitor and add background location (Android first).

## New in version 4

**Traveller app, reorganised into sections:** Safety Map · Safe Journey · Alerts · Safe Circle · Emergency SOS · Community Watch · Emergency Services · My Account (plus Fleet for fleet managers). Phones get a bottom bar (Map, Journey, Alerts, Circle, More). The red SOS button stays on screen in every section, with three safeguards against accidental alerts: press-and-hold for 2 seconds, then a 5-second countdown with a large Cancel button, and a PIN (or duress PIN) to cancel once sent. My Account has profile, notifications, privacy (download my data, delete my account), two-step verification and devices. The status card shows the LGA and state you are in.

**Command Centre at `/admin`** — a separate dashboard for administrators, moderators and verified security partners (two-step verification required):

| Module | What it does |
|---|---|
| National Overview | KPIs and a map, drilling down Nigeria → State → LGA → community |
| Live Incident Map | All active reports and SOS, refreshed every 15 s |
| SOS Command Centre | Open emergencies, timers, acknowledgement, assignment, delivery receipts, notes, optional alarm |
| Security Intelligence | Hotspots, rising areas, time-of-day and weekday patterns |
| Report Verification | Queue with evidence, confirmations, nearby reports, reporter record, history |
| Agency Management | Agencies, their jurisdictions (states/LGAs) and officers |
| Emergency Facilities | Directory, verification, public suggestions, coverage gaps |
| User Management | Roles, agency links, trust, suspension, two-step reset |
| Analytics | Incidents by state/LGA, kidnapping, robbery, floods, response times, CSV export |
| System Configuration | Operational switches, notice banner, SOS and risk rules, categories, audit log |

Every figure is split into three layers that are never added together as "crime statistics":
**Community reports** (unverified, not confirmed) · **Verified incidents** (verified by SafeRoute moderators) · **Official agency records** (recorded by verified security agencies). Rejected reports are excluded. Security partners see only their agency's jurisdiction.

Boundaries: Nigeria LGA boundaries 2022 from GRID3 / geoBoundaries (CC BY 4.0), bundled in `shared/ng-admin.json`. Community names come from OpenStreetMap Nominatim (© OpenStreetMap contributors), looked up at most once a second.

## Android app (version 5)

The Android app in `android-app/` is a Capacitor shell that opens https://saferoute.jobtins.com and adds what a website can't do:

- **GPS with the screen off** during warnings, Safe Journey and SOS (Android shows a "SafeRoute is watching your route" notification while it runs). Background updates go through a per-device token (`/api/beacon`) and native HTTP so Android doesn't throttle them.
- **App notifications** through Firebase Cloud Messaging (SOS and journey alerts use a high-priority "Emergency alerts" channel).
- Android back button, notification taps that open the right screen, app icon and splash screen, and an offline page with a Call 112 button.

Updates to the website reach the app straight away; the APK only needs rebuilding when `android-app/` changes.

**Build:** GitHub builds it (`.github/workflows/android.yml`) whenever `android-app/` changes, on tags like `android-v1.0`, or from Actions → Build Android app → Run workflow. The APK appears under the run's **Artifacts**.

**Secrets** (GitHub → Settings → Secrets and variables → Actions): `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` for a signed release APK + Play Store bundle; `GOOGLE_SERVICES_JSON` (base64) for notifications. Without the signing secrets you get a debug APK.

**Server:** set `FCM_SERVICE_ACCOUNT` in `.env` to the Firebase service-account file. Put the APK at `data/downloads/saferoute.apk` to offer it at `/download/saferoute.apk` (Android browser users see a download button in My Account).

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

### SMS (optional)

Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`) to `.env` and restart. The Admin tab shows SMS On/Off.

### Notifications for responders

Each responder opens the app on their phone, goes to **Security** (or **Circle**) and taps **Turn on notifications**. On iPhone they must first add the app to the Home Screen.

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

`GET /api/risk?lat=5.16&lng=6.87&hour=22` returns the threat level, confidence, reasons and recommended action for any point.

## Outside services and their limits

- **Routes:** the free public OSRM server (light use only). For heavy use, run your own OSRM or switch `ROUTER_URL`.
- **Place search:** OpenStreetMap Nominatim, limited to about one search per second (the server queues and caches).
- **Weather:** Open-Meteo, free, cached for 30 minutes per area.
- **Maps:** Esri satellite and OpenStreetMap street tiles.

## Limits of a web app

- Alerts only run while the app is open on screen. Driver Mode keeps the screen awake where the phone allows it.
- For alerts with the screen off, wrap this app with Capacitor and add a background-location plugin (Phase 2 in the blueprint).
- Map imagery comes from Esri (satellite) and OpenStreetMap (street). Both are free for light use. Move to a paid tile plan (for example Mapbox or MapTiler) when traffic grows.
