# Wandel – Installation auf dem iPhone

## Einmalig online stellen (kostenlos, ca. 10 Minuten)

Online liegt nur der Programmcode. Deine Daten bleiben auf dem iPhone.

1. Auf https://github.com ein kostenloses Konto anlegen.
2. Oben rechts **+ → New repository**. Name z. B. `wandel`, **Public**, dann **Create repository**.
3. Auf der neuen Seite auf **uploading an existing file** klicken.
4. Den **Inhalt** dieses Ordners (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` und den Ordner `icons`) ins Browserfenster ziehen. **Commit changes** klicken.
5. **Settings → Pages**. Bei *Branch* `main` und `/ (root)` wählen, **Save**.
6. Nach 1–2 Minuten steht oben die Adresse, z. B. `https://DEINNAME.github.io/wandel/`.

## Auf dem iPhone installieren

1. Die Adresse in **Safari** öffnen (nicht Chrome).
2. Teilen-Symbol → **Zum Home-Bildschirm** → Hinzufügen.
3. Ab jetzt nur noch über das Icon auf dem Home-Bildschirm öffnen. Die App läuft dann auch offline.

## Updates

Geänderte Dateien in GitHub erneut hochladen (gleiche Namen, ersetzt die alten).
In `sw.js` die Zeile `VERSION = 'wandel-v1'` hochzählen (v2, v3 …).
Die App lädt den neuen Code beim nächsten Öffnen. Deine Daten bleiben unberührt.

## Datensicherung

- Mehr → Datensicherung → **Backup erstellen** → „In Dateien sichern".
- Einmal pro Woche, die App erinnert dich.
- Wiederherstellen: gleiche Seite → **Datei auswählen**.
- Achtung: Wer das App-Icon löscht, löscht auch die Daten. Dann hilft nur das Backup.
