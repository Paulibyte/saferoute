/* SafeRoute Command Centre — staff guide content.
   roles: 'all' = every staff member; 'mod' = moderators; 'security' = security partners; 'admin' = administrators.
   go: the Command Centre module the "Open" button jumps to. Edit this file to update the guide. */
window.SR_STAFF_GUIDE = [
{ id: 'basics', title: 'How SafeRoute works', roles: ['all'], html: `
<p>SafeRoute has two front doors on one server: the <b>traveller app</b> (saferoute.jobtins.com) and this <b>Command Centre</b> (/admin). What you approve here appears in the app within a minute.</p>
<h3>The three information layers — the most important rule</h3>
<ul><li><span class="pill p-community">Community</span> what members of the public report. <b>Not confirmed.</b></li>
<li><span class="pill p-verified">Verified</span> checked by a SafeRoute moderator.</li>
<li><span class="pill p-official">Official</span> recorded or confirmed by a verified security agency.</li></ul>
<p>The dashboard never adds these together. When you quote any figure outside SafeRoute, name the layer and the period, e.g. “12 verified kidnapping incidents in Imo State, 1 Sep–30 Nov 2026 (SafeRoute verified incidents; not an official crime statistic)”. <b>Never present community reports as crime statistics.</b></p>
<h3>Who can do what</h3>
<table><tr><th>Role</th><th>Can do</th></tr>
<tr><td>Security officer</td><td>Respond to SOS, confirm reports as official, post advisories; sees only their agency's jurisdiction</td></tr>
<tr><td>Agency supervisor</td><td>As an officer, plus verify officers of their own agency</td></tr>
<tr><td>Moderator</td><td>Verify or reject reports, manage facilities, see all states</td></tr>
<tr><td>Admin</td><td>Everything, including agencies, users, settings and the audit log</td></tr></table>
<p>All staff must use two-step verification. Until it is set up, a staff account works only as a traveller account.</p>
<h3>Finding your way</h3>
<p>Use the area selector at the top (Nigeria › State › LGA) and the period selector. Every module follows them. Click a state or LGA in any table or map to drill down.</p>` },

{ id: 'verify', title: 'Verifying community reports', roles: ['mod', 'security'], go: 'verify', html: `
<p>Look at every new security report within <b>30 minutes</b> during the day, and road hazards within <b>2 hours</b>. A single unconfirmed crime report stays hidden from the public until its confidence reaches 45% or a moderator acts.</p>
<h3>The routine</h3>
<ol><li>Open <b>Report Verification</b>, filter “To review”. Security reports and anyone injured or trapped are at the top. Work from the top.</li>
<li>Open a report and look at: the photo or video, description, time and place, <b>community confirmations</b> (who, how far away, how recent), <b>nearby reports</b> (3 km, 24 h) and the <b>reporter's record</b>.</li>
<li>Check outside the app where you can: call the nearest police division or FRSC unit (from Emergency Facilities), a trusted local contact, or credible local news.</li>
<li>Choose an action and always write a short note (“Confirmed by Ikwerre Division by phone 14:20”).</li></ol>
<table><tr><th>Action</th><th>When</th><th>Effect</th></tr>
<tr><td><b>Verify</b></td><td>Independent confirmation: an agency, a trusted contact, credible news, or several nearby confirmations from different trusted users</td><td>Shown as Verified; counts as a verified incident; full weight in risk</td></tr>
<tr><td><b>Under investigation</b></td><td>Plausible; you have started checking</td><td>Shown as under investigation</td></tr>
<tr><td><b>Reject</b></td><td>False, duplicate, joke, abusive, wrong place</td><td>Removed from the map and all statistics; reporter's trust drops</td></tr>
<tr><td><b>Resolved</b></td><td>Real but over (road cleared, flood gone)</td><td>Off the live map; kept in history</td></tr>
<tr><td><b>Correct the category</b></td><td>Right event, wrong type</td><td>Pick the right type, add a note, then verify</td></tr>
<tr><td><b>Confirm as official</b> (officers)</td><td>Your agency has confirmed it</td><td>Becomes an official record with your agency's name</td></tr></table>
<h3>Rules</h3>
<ul><li>Never verify because it “sounds right” or because many anonymous people tapped confirm. Confirmations from new accounts, far away, or the same reporter count for little.</li>
<li>Never publish photos showing victims, faces, children, individual officers or vehicle plates. Videos are always staff-only.</li>
<li>If people are in danger right now, call the agency first, then verify.</li></ul>` },

{ id: 'sos', title: 'Handling an SOS', roles: ['security', 'admin'], go: 'sos', html: `
<p>Every SOS must be acknowledged by a person within <b>3 minutes</b>. If not, the alert widens to more responders at 3 minutes and to all responders at 10 minutes.</p>
<p><b>On duty:</b> keep the SOS Command Centre open with <b>Alarm for new SOS</b> ticked and the volume up, especially 6–10 am and 4–9 pm. Officers should also turn on app notifications on their phones.</p>
<h3>When an SOS arrives</h3>
<ol><li>Read the card: emergency type, name and phone, community / LGA / state, time open, and whether alerts reached the Safe Circle.</li>
<li>Press <b>Acknowledge</b> at once — the person and their Safe Circle see that a human has seen it.</li>
<li>Call the person if a number is shown. If there is no answer, <b>don't keep ringing</b>: a ringing phone can endanger someone hiding.</li>
<li><b>Assign</b> it to an officer or agency and phone that agency's control room. Add a <b>Note</b> of who you called and when.</li>
<li>Update the status: <b>Responding</b> → <b>On scene</b>. The person sees each change.</li>
<li>Close it with the right reason: Resolved, Handed over, Could not reach, or False alarm.</li></ol>
<div class="warnbox"><b>DURESS</b> means the person entered their duress PIN: it looks cancelled on their phone but they may be under threat. Treat it as live and do not contact them in a way that reveals the alert.</div>
<ul><li>The red trail on the map shows their movement; location updates every 15 seconds.</li>
<li>“Live link” opens the same tracking page their Safe Circle sees.</li>
<li>SafeRoute supports emergency services but does not replace 112. Never tell a user help is coming unless an agency has confirmed it.</li></ul>` },

{ id: 'advisory', title: 'Posting official records and advisories', roles: ['mod', 'security'], html: `
<ol><li>In the SafeRoute app, open <b>Community Watch → Report an incident or hazard</b> and tap the exact spot on the map.</li>
<li>Choose the category, describe it, add a photo if useful. Moderators' reports publish as <b>Verified</b>; verified officers' reports publish as <b>Official records</b> with the agency's name.</li></ol>
<p><b>Advisories</b> (officers and admins): choose the category <b>Advisory</b> for curfews, planned road closures, moved checkpoints, VIP movement or flood warnings. Write it as an instruction: “Avoid Owerri–Umuagwo road after 6 pm until Friday; use Port Harcourt Road”.</p>
<p><b>Lifetimes:</b> each category expires on its own (a fallen tree in hours, a collapsed bridge in 30 days). If something ends early, mark it <b>Resolved</b>. If it lasts longer, post a fresh report or advisory.</p>
<p>Officers can press <b>Responding</b> on a report so travellers see that security is on the way.</p>` },

{ id: 'facilities', title: 'Emergency facilities', roles: ['mod', 'security'], go: 'facilities', html: `
<p>Facilities appear in the app's Emergency Services and <b>security posts lower the risk score nearby</b>. A wrong or closed police post makes an area look safer than it is, so accuracy matters more than quantity.</p>
<h3>Add a facility (moderators)</h3>
<ol><li>Emergency Facilities → <b>Add facility</b>. Choose the type.</li>
<li>Enter the name, a phone that is answered, hours (“24 hours” only where true) and an address or landmark.</li>
<li>Click the map at the exact entrance — zoom in until you can see the road.</li>
<li>Tick “Verified today” only if the details were confirmed by phone or visit in the last few days.</li></ol>
<h3>Keep it current</h3>
<ul><li>A listing counts as verified for 365 days. Tick “needs verification”, call each one, then press <b>Verify today</b>.</li>
<li>Moved or closed? Edit it straight away. Delete only listings that never existed.</li>
<li><b>Coverage gaps</b> shows states or LGAs with no verified security post, health facility, fire service or ambulance — collect those next.</li>
<li>Approve public <b>suggestions</b> only if you can confirm them.</li></ul>
<p>Good sources: State Police Command PRO (list of divisions), FRSC sector command, State Ministry of Health facility register, SEMA, fire service HQ. Note the source in the address field.</p>` },

{ id: 'intel', title: 'Intelligence and reporting by State and LGA', roles: ['all'], go: 'analytics', html: `
<table><tr><th>Question</th><th>Where</th></tr>
<tr><td>Incidents per state</td><td>National Overview at “All states”</td></tr>
<tr><td>Incidents per LGA and community</td><td>Pick a state, then an LGA</td></tr>
<tr><td>Verified kidnapping incidents</td><td>Analytics → Kidnapping (Verified and Official columns)</td></tr>
<tr><td>Areas with increasing robbery</td><td>Security Intelligence, category Armed robbery → Increasing</td></tr>
<tr><td>Flood-affected communities</td><td>Analytics → Flood-affected communities</td></tr>
<tr><td>Emergency response times</td><td>Analytics → SOS cards and Emergency response</td></tr>
<tr><td>Areas without verified facilities</td><td>Emergency Facilities → Coverage gaps</td></tr>
<tr><td>Where to send a moderator or patrol</td><td>Security Intelligence → Community signals</td></tr></table>
<h3>Rules for figures</h3>
<ul><li>Hotspots, “increasing” areas, map shading and time charts use <b>verified and official incidents only</b>.</li>
<li>Community reports tell you where to look, not what happened.</li>
<li>No reports does not mean safe — the area may have few SafeRoute users.</li>
<li>Small numbers swing: “+200%” from 1 to 3 incidents is a prompt to check, not a trend.</li>
<li>Keep the first line of every CSV (it defines the layers) when you forward it.</li></ul>` },

{ id: 'officers', title: 'Agencies, officers and staff accounts', roles: ['admin', 'supervisor'], go: 'agencies', html: `
<h3>Add an agency (admins)</h3>
<ol><li>Agency Management → <b>Add agency</b>: name as the public knows it, type, a staffed control-room phone.</li>
<li>Click the map for the base location.</li>
<li>Under <b>Jurisdiction</b> tick whole states, or a state's individual LGAs. Officers see only these areas. Leave empty only for national agencies.</li>
<li>Keep “Listed” ticked so officers can pick it when registering.</li></ol>
<h3>Verifying officers (admins and supervisors)</h3>
<ol><li>The officer registers in the app, ticks the security personnel box and picks their agency.</li>
<li>They appear as “awaiting” under Agency Management → Officers.</li>
<li><b>Before pressing Verify, confirm identity outside the app</b> — a call to the agency's control room or a letter from their commander. Never on a name alone.</li>
<li>Make one trusted officer per agency a <b>supervisor</b>.</li></ol>
<h3>User Management (admins)</h3>
<table><tr><th>Task</th><th>How</th></tr>
<tr><td>Make a moderator</td><td>Change role to moderator</td></tr>
<tr><td>Reliable reporter</td><td>⭐ Trust (their reports get more weight)</td></tr>
<tr><td>Lost phone</td><td>Reset 2-step</td></tr>
<tr><td>Abuse, false reports, impersonation</td><td>Suspend (signs them out at once)</td></tr>
<tr><td>Officer leaves the agency</td><td>Role back to traveller, clear agency</td></tr></table>
<p>Review the staff list monthly and remove anyone who no longer needs access.</p>` },

{ id: 'config', title: 'Risk rules, area types and switches', roles: ['admin'], go: 'config', html: `
<p>Change one thing at a time and watch the map for a week before changing the next. Every change is in the audit log.</p>
<p><b>How risk is worked out:</b> points from active reports nearby (fading with each category's half-life) + past verified incidents within 5 km + 4 points if no confirmed security post within 10 km + heavy rain; multiplied for dusk (×1.15), night (×1.35) and isolated area types. Moderate from 12, High 30, Severe 55. Tourist Mode warns 5 points earlier.</p>
<table><tr><th>Setting</th><th>Default</th><th>Change when</th></tr>
<tr><td>Level cut-offs</td><td>12, 30, 55</td><td>Too many warnings (raise) or missed danger (lower)</td></tr>
<tr><td>Night multiplier</td><td>1.35</td><td>Night travel is riskier than the map shows</td></tr>
<tr><td>No security post points</td><td>4</td><td>Only once police posts are well mapped</td></tr>
<tr><td>Unverified report public from</td><td>0.45</td><td>Raise to show fewer unchecked reports</td></tr>
<tr><td>SOS widen / alert all</td><td>3 / 10 min</td><td>Responders are slower or faster</td></tr>
<tr><td>Responder alert radius</td><td>60 km</td><td>Officers alerted too far away</td></tr>
<tr><td>Community alerts per hour</td><td>10</td><td>Complaints about too many notifications</td></tr></table>
<p><b>Area types:</b> click the map under Area types to mark Urban, Peri-urban, Rural or Forest / isolated stretch (radius up to 50 km). Mark long isolated highway stretches — they get a higher multiplier after dark. Unmarked places count as rural.</p>
<p><b>Switches:</b> <i>Community alerts off</i> stops location-based alerts (e.g. during a panic from false reports); SOS, journey and Safe Circle alerts keep working. <i>Public reporting off</i> stops new public reports; staff can still post. Turn them back on as soon as possible.</p>
<p><b>Notice banner:</b> one line at the top of the app for everyone. Clear it when it no longer applies.</p>` },

{ id: 'routine', title: 'Daily, weekly and monthly routine', roles: ['all'], html: `
<table><tr><th>When</th><th>Task</th><th>Who</th></tr>
<tr><td>Every 30 min (day)</td><td>Clear new security reports</td><td>Moderator on duty</td></tr>
<tr><td>Peak hours</td><td>Watch for SOS with the alarm on</td><td>Officer / admin on duty</td></tr>
<tr><td>Morning</td><td>Check overnight reports, open SOS, Live Incident Map</td><td>Lead moderator</td></tr>
<tr><td>Evening</td><td>Resolve cleared hazards; post night advisories</td><td>Moderator / officer</td></tr>
<tr><td>Weekly</td><td>Rising areas in Security Intelligence; brief agencies</td><td>Admin</td></tr>
<tr><td>Weekly</td><td>Facility suggestions; verify 10–20 expiring facilities</td><td>Moderator</td></tr>
<tr><td>Weekly</td><td>Response times and unacknowledged SOS</td><td>Admin</td></tr>
<tr><td>Weekly</td><td>Verify pending officers</td><td>Admin / supervisors</td></tr>
<tr><td>Monthly</td><td>Download CSVs, send the state report to agencies</td><td>Admin</td></tr>
<tr><td>Monthly</td><td>Review staff list and audit log; review risk settings</td><td>Admin</td></tr>
<tr><td>Rainy season</td><td>Mark flood-prone stretches; longer road-condition lifetimes</td><td>Admin</td></tr>
<tr><td>Festive periods</td><td>Extra moderator cover; travel notice banner</td><td>Admin</td></tr></table>` },

{ id: 'privacy', title: 'Privacy and conduct', roles: ['all'], html: `
<ul><li>Use the Command Centre only for SafeRoute work. Never look up a person, their location or their reports for any other reason. Every action is logged with your name.</li>
<li>Never share screenshots that show names, phone numbers, faces, plates or home locations. Use the Analytics tables, which contain counts only.</li>
<li>Never ask a user for their password or two-step code.</li>
<li>Sign out on shared computers. Keep two-step verification on your own phone.</li>
<li>Report a lost phone at once so an admin can reset your two-step verification.</li></ul>
<p>SafeRoute handles personal data under the Nigeria Data Protection Act 2023. Users can download or delete their data from My Account.</p>` },

{ id: 'server', title: 'Server: updates and backups', roles: ['admin'], html: `
<p>Data lives in <code>/var/www/saferoute/data/saferoute.db</code> and <code>/var/www/saferoute/data/uploads</code>. Never edit code on the server — change it on your PC, push to GitHub, then pull.</p>
<h3>Install an update</h3>
<pre>cd /var/www/saferoute && git pull && npm install --omit=dev && pm2 restart saferoute && pm2 logs saferoute --lines 15</pre>
<h3>Daily backups (set up once)</h3>
<pre>apt install -y sqlite3
mkdir -p /root/backups/saferoute
crontab -e</pre>
<p>Add:</p>
<pre>15 2 * * * sqlite3 /var/www/saferoute/data/saferoute.db ".backup '/root/backups/saferoute/db-$(date +\\%F).db'" && find /root/backups/saferoute -name 'db-*' -mtime +14 -delete
30 2 * * 0 tar czf /root/backups/saferoute/uploads-$(date +\\%F).tgz -C /var/www/saferoute/data uploads && find /root/backups/saferoute -name 'uploads-*' -mtime +60 -delete</pre>
<p>Copy the newest backup off the server weekly.</p>
<h3>Restore</h3>
<pre>pm2 stop saferoute
cp /var/www/saferoute/data/saferoute.db /root/saferoute-before-restore.db
cp /root/backups/saferoute/db-YYYY-MM-DD.db /var/www/saferoute/data/saferoute.db
rm -f /var/www/saferoute/data/saferoute.db-wal /var/www/saferoute/data/saferoute.db-shm
pm2 start saferoute</pre>
<p>Do not add or change <code>APP_SECRET</code> in <code>.env</code>: it would break everyone's two-step codes.</p>` },

{ id: 'trouble', title: 'Troubleshooting', roles: ['all'], html: `
<table><tr><th>Problem</th><th>Fix</th></tr>
<tr><td>Staff member sees only the traveller app</td><td>Set up two-step in My Account; check role in User Management</td></tr>
<tr><td>“Not authorised” here</td><td>Account is a traveller or an unverified officer — verify them</td></tr>
<tr><td>Officer sees no incidents</td><td>Agency jurisdiction excludes the area — edit the agency</td></tr>
<tr><td>Report here but not in the app</td><td>Unverified security report below 45% confidence — verify or mark under investigation</td></tr>
<tr><td>Cleared hazard still shows</td><td>Mark it Resolved</td></tr>
<tr><td>Town risky at night for no reason</td><td>Add and verify its police post; add an Urban / Peri-urban area type</td></tr>
<tr><td>No push notifications</td><td>Users turn them on in My Account; iPhone users must “Add to Home Screen” first</td></tr>
<tr><td>Old version after an update</td><td>Close and reopen the app; Ctrl+Shift+R on desktop</td></tr>
<tr><td>Site down (502)</td><td><code>pm2 logs saferoute --lines 50</code>, then <code>pm2 restart saferoute</code></td></tr>
<tr><td>Lost your two-step phone</td><td>Use a backup code, or ask another admin to reset it. Keep at least two admins.</td></tr></table>` }
];
