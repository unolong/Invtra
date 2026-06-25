FridgeAI – Projektkontext für Claude Code
Was ist die App?
Eine KI-gestützte Makro-Tracking App für iOS und Android. Der Nutzer erfasst was er isst, die App zeigt wie weit er von seinen Tageszielen entfernt ist, schlägt Rezepte aus dem Inventar vor und führt ihn durch das Kochen.
Primäre Zielgruppe: Fitness-affine Personen (18–30) die Makros tracken aber eine intelligentere Lösung als MyFitnessPal suchen.

Tech Stack

React Native mit Expo (Managed Workflow)
Expo Router (File-based Routing)
TypeScript
Open Food Facts API – Barcode-Scan Produktdaten (kostenlos, kein API Key)
Anthropic API (claude-sonnet-4-20250514) – Rezeptvorschläge, KI-Bilderkennung
AsyncStorage – Datenpersistenz lokal auf dem Gerät
Expo Camera – Kamera für Foto-Erkennung und Barcode-Scan
Kein Backend – alles läuft lokal


Design System
Farben

Hintergrund: #0a0a0a
Surface 1: #111111
Surface 2: #181818
Border: #222222
Text primär: #f0f0f0
Text sekundär: #666666
Akzent (Lime): #c8ff00
Protein: #4F8EF7 (Blau)
Carbs: #F7A94F (Orange)
Fett: #F74F4F (Rot)
Grün (Verbrannt/Positiv): #26de81

Komponenten

Border-Radius Cards: 16px
Border-Radius Buttons: 12–14px
Alle Cards: 1px Border #222222, Hintergrund #111111


Screens & Features
1. Home Screen (Heute)

Datum + App-Logo + Icon oben
Kcal-Reihe: Gegessen / Verbrannt / Übrig (drei Cards)
Makro-Ring (Donut-Chart) mit Protein/Carbs/Fett Fortschrittsbalken
Hinweis-Card: "Dir fehlen noch Xg Protein – N Rezepte passen" mit Pfeil zu Rezepte Screen
Mahlzeiten: Frühstück / Mittagessen / Abendessen / Snacks mit Items und Plus-Button
Bottom Nav: Heute / + (groß, rund, Akzent) / Inventar / Profil

2. Essen eintragen Screen

Mahlzeit-Chips: Frühstück / Mittagessen / Abendessen / Snacks
Scan-Optionen: Foto (groß, primär) / Barcode / Sprache
Suchleiste
"Zuletzt" – horizontaler Scroll zuletzt gegessener Items
"Vorschläge" – häufige Items mit + Button
Bereits eingetragene Items der gewählten Mahlzeit oben sichtbar

3. Kamera Screen

Vollbild-Kamera mit Rahmen-Guide
Zwei Modi: Gericht erkennen / Barcode
Flash-Toggle, Mahlzeit-Label, Shutter-Button

4. KI-Ergebnis Screen (Gericht)

Foto mit Bounding Boxes und Zutaten-Labels
Konfidenz-Score, Gesamt-kcal, Makro-Badges
Liste erkannter Zutaten mit Checkbox, Menge, Konfidenz
"Versteckte Kalorien?" aufklappbar
CTA: "Zu [Mahlzeit] hinzufügen"

5. Rezepte Screen

Restliche Tagesmakros oben
Filter-Chips: Alle / Inventar-Match / <15 Min. / Vegetarisch
Rezept-Cards mit Match-%, Zeit, Inventar-Status, Makros

6. Inventar Screen

Ablauf-Warnkarte für bald ablaufende Items
"Jetzt aufbrauchen" – Rezept-Cards aus ablaufenden Zutaten
Scan-Buttons: Kühlschrank scannen (primär) / Barcode / + manuell
Tabs: Kühlschrank / Vorrat / Tiefkühler
Items mit Haltbarkeit in Tagen

7. KI-Ergebnis Screen (Inventar-Scan)

Foto mit Farb-Segmentierung
Liste erkannter Produkte mit Checkbox und Konfidenz
CTA: "N Artikel ins Inventar"

8. Profil Screen

Tagesziele, Körperdaten, Einstellungen
Akzentfarbe wählbar, Ziel-Slider


Nährwerte
Pflicht (sichtbar): Kalorien, Protein, Kohlenhydrate, Fett, Ballaststoffe, Zucker
Optional (aufklappbar): Vitamine, Mineralien, Natrium, gesättigte Fettsäuren

Wichtige Hinweise

Expo Managed Workflow – kein Ejecting
Node.js v24, Windows, Expo Go zum Testen
Open Food Facts: https://world.openfoodfacts.org/api/v0/product/{barcode}.json
UI-Sprache: Deutsch
Kein Backend, alles lokal auf dem Gerät
Kein Supplement-Tracking, keine Einkaufsliste
7-Tage-Streak ist das einzige Gamification-Element


Aktueller Stand
Home Screen als statischer Prototyp mit hardgecodeten Werten. Kein State Management, keine Navigation, keine API-Calls. Alles neu bauen nach High Fidelity Design.