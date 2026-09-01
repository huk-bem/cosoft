# CoSoft

Projektplanung, Terminplanung und Kanban-Board für Software- & App-Entwicklungs-Teams —
**pro Kunde ein eigener, geschützter Bereich**, mit Login, Mehrbenutzer-Zugriff und
Synchronisation über mehrere Geräte hinweg. Termine und Kanban-Karten sind **intelligent
verknüpft**: Ein Fälligkeitsdatum an einer Karte erzeugt automatisch den passenden Termin —
und wird der Termin im Kalender verschoben, zieht die Deadline der Karte automatisch mit.

## Inhalt dieses Repos

| Datei / Ordner | Zweck |
|---|---|
| `index.html` | Marketing-One-Pager (Landingpage) |
| `datenschutz.html`, `impressum.html` | Rechtliche Pflichtseiten (**Platzhalter, siehe unten**) |
| `app/auth.html` | Login / Registrierung |
| `app/dashboard.html` | Die eigentliche App: Kunden, Kanban-Board, Terminplanung |
| `app/config.js` | Supabase-Zugangsdaten (hier eintragen) |
| `app/style.css`, `app/app.js`, `app/supabase-client.js` | Styles & Anwendungslogik |
| `supabase/schema.sql` | Komplettes Datenbankschema inkl. Sicherheit & Verknüpfungslogik |

Keine Build-Schritte, kein Framework — reines HTML/CSS/JS, das direkt gegen ein
[Supabase](https://supabase.com)-Projekt (Postgres-Datenbank + Auth + Realtime) spricht.

## 1. Supabase-Projekt einrichten (einmalig)

> **Status: für dieses Projekt bereits erledigt.** Angebunden ist das Supabase-Projekt
> `vmjivwfieyfnlcejkktu` (Region eu-central-1 / Frankfurt); das Schema aus
> `supabase/schema.sql` ist eingespielt und die Zugangsdaten stehen in `app/config.js`.
> Die folgenden Schritte sind nur nötig, wenn du ein *weiteres* Projekt aufsetzt.


1. Kostenloses Konto auf [supabase.com](https://supabase.com) anlegen, neues Projekt erstellen
   (Region z. B. **EU Central (Frankfurt)** wählen, relevant für Datenschutz/DSGVO).
2. Im Projekt zu **SQL Editor → New query** gehen, den kompletten Inhalt von
   [`supabase/schema.sql`](supabase/schema.sql) einfügen und ausführen. Das legt alle Tabellen,
   Sicherheitsregeln (Row Level Security) und die automatische Termin-Verknüpfung an.
3. Unter **Project Settings → API** die Werte **Project URL** und **anon public key** kopieren.
4. Diese beiden Werte in [`app/config.js`](app/config.js) eintragen:

   ```js
   window.COSOFT_CONFIG = {
     SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
     SUPABASE_ANON_KEY: 'eyJhbGciOi...',
   };
   ```

   Der `anon`-Key ist bewusst öffentlich/clientseitig sichtbar (Supabase-Standard) — die
   eigentliche Absicherung übernimmt Row Level Security aus `schema.sql`. Verwende hier
   **niemals** den `service_role`-Key.

5. Unter **Authentication → Providers** ist "Email" standardmäßig aktiv. Für schnelles Testen
   kannst du unter **Authentication → Settings** die Pflicht zur E-Mail-Bestätigung
   ("Confirm email") vorübergehend deaktivieren.
6. Unter **Database → Replication** prüfen, dass `customers`, `customer_members`,
   `board_columns`, `tasks`, `events` für Realtime aktiviert sind (das Schema aktiviert das
   bereits automatisch über `supabase_realtime`).

## 2. Lokal starten

Da die Seiten `fetch`/ES-Module nutzen, am besten über einen einfachen lokalen Server öffnen
(nicht per Doppelklick als `file://`):

```bash
npx serve .
# oder: python3 -m http.server 8080
```

Dann `http://localhost:PORT/index.html` (Landingpage) bzw.
`http://localhost:PORT/app/auth.html` (Login) öffnen.

## 3. Deployment

Es handelt sich um eine rein statische Seite — jeder Static-Hosting-Anbieter funktioniert.

### GitHub Pages (vorbereitet)

Der Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) ist bereits eingerichtet
und deployt bei jedem Push auf `main` automatisch. **Einmalig muss GitHub Pages aber noch von Hand
freigeschaltet werden** (ein Automatismus dafür scheitert an fehlenden Rechten des GitHub-App-Tokens:
`Create Pages site failed – Resource not accessible by integration`):

1. Repo → **Settings** → **Pages**
2. Unter *Build and deployment* → **Source: GitHub Actions** auswählen
3. Danach unter **Actions** den Workflow „Deploy to GitHub Pages" einmal per *Run workflow* starten
   (oder einfach den nächsten Commit pushen)

Die Seite liegt anschließend unter `https://huk-bem.github.io/cosoft/`.

### Vercel / Netlify

Alternativ auf [vercel.com](https://vercel.com) → *Add New… → Project* → Repository `huk-bem/cosoft`
importieren. Framework-Preset: *Other*, kein Build-Command, Output-Verzeichnis: Projektwurzel.

> `app/config.js` muss vor dem Go-Live mit den echten Supabase-Werten ausgefüllt sein.

## 4. Funktionsüberblick

- **Konto & Schutz**: Registrierung/Login per E-Mail & Passwort (Supabase Auth). Ohne aktive
  Session leitet `dashboard.html` automatisch zu `auth.html` um.
- **Kunden**: Jeder Kunde ist ein eigener, datenbankseitig abgeschotteter Bereich
  (Row Level Security). Beim Anlegen werden automatisch 4 Standard-Kanban-Spalten erzeugt.
- **Mehrbenutzer pro Kunde**: Der Ersteller eines Kunden kann weitere registrierte Nutzer:innen
  per E-Mail einladen (`invite_member_by_email`). Eingeladene sehen den Kunden ab sofort auf
  allen ihren Geräten.
- **Multi-Device**: Da alle Daten zentral in Postgres liegen (nicht im Browser), sind Login und
  Datenstand auf jedem Gerät identisch. Änderungen werden zusätzlich per Supabase Realtime
  live an alle offenen Sitzungen gepusht.
- **Kanban**: Drag & Drop von Karten zwischen Spalten, Priorität, Fälligkeitsdatum, Zuweisung
  per E-Mail.
- **Terminplanung**: Monatskalender pro Kunde. Termine können direkt angelegt werden oder
  entstehen automatisch aus dem Fälligkeitsdatum einer Kanban-Karte (mit 🔗-Symbol markiert).
- **Intelligente Verknüpfung** (siehe `supabase/schema.sql`, Abschnitt 5): Datenbank-Trigger
  synchronisieren `tasks.due_date` und `events.event_date` bidirektional — unabhängig davon, ob
  die Änderung im Kanban-Board oder im Kalender vorgenommen wurde, und unabhängig vom Gerät.

## 5. Vor dem Live-Betrieb unbedingt erledigen

- [ ] `datenschutz.html` und `impressum.html` mit echten Firmen-/Kontaktdaten ausfüllen
      (aktuell reine Platzhalter — **nicht rechtssicher im aktuellen Zustand**).
- [ ] Auftragsverarbeitungsvertrag (AVV) mit Supabase abschließen, EU-Serverstandort prüfen.
- [ ] E-Mail-Bestätigung bei der Registrierung wieder aktivieren (Produktionsbetrieb).
- [ ] Eigenes Branding/Logo/Domain ergänzen.

## 6. Datenmodell (Kurzfassung)

```
customers (Kunde)
 ├─ customer_members (wer hat Zugriff)
 ├─ board_columns (Kanban-Spalten)
 ├─ tasks (Kanban-Karten, mit due_date)
 └─ events (Kalendertermine; task_id gesetzt = automatisch verknüpft)
```

Details, Policies und Trigger: siehe [`supabase/schema.sql`](supabase/schema.sql).
