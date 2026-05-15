# FridgeAI – Projektkontext für Claude Code

## Was ist FridgeAI?

Eine Makro-Tracking App für iOS und Android. Der Nutzer erfasst was er isst, die App zeigt wie weit er von seinen Tageszielen entfernt ist, und schlägt Rezepte vor die seinen Kühlschrank-Inhalt mit den restlichen Makros kombinieren.

Ziel: Möglichst einfach und schlank. Kein Feature-Bloat, keine Gamification.

---

## Tech Stack

- React Native mit Expo (Managed Workflow)
- Expo Router (File-based Routing)
- TypeScript
- Open Food Facts API (kostenlos, kein API Key nötig) für Produktdaten per Barcode
- Anthropic API (claude-sonnet-4-20250514) für Rezeptvorschläge basierend auf Kühlschrank-Inhalt und restlichen Makros

---

## Aktueller Stand

- Home Screen (app/(tabs)/index.tsx) ist gebaut
- Zeigt gegessene Kalorien, übrige Kalorien, Fortschrittsbalken für Protein / Kohlenhydrate / Fett
- Zwei Buttons: "Was kann ich kochen?" und "Essen eintragen" – noch nicht funktional
- Alle Daten sind noch hardcoded, kein State Management eingebaut

---

## Was als nächstes gebaut werden muss

### 1. Essen eintragen Screen
- Barcode scannen via expo-camera
- Produktdaten von Open Food Facts API abrufen (Makros, Name, Portionsgröße)
- Alternativ: manuelle Textsuche
- Eingetragenes Essen aktualisiert die Makros auf dem Home Screen

### 2. Was kann ich kochen? Screen
- Nutzer gibt Kühlschrank-Inhalt ein (manuell oder per Foto/Barcode)
- App schickt Kühlschrank-Inhalt + restliche Tagesmakros an Anthropic API
- API gibt einen konkreten Rezeptvorschlag zurück der die Lücke möglichst gut füllt

### 3. State Management
- Tägliche Makros und gegessene Lebensmittel global verfügbar machen
- Einfache Lösung bevorzugt: Zustand (Zustandsverwaltungsbibliothek) oder React Context
- Daten sollen den Tag über persistent bleiben (AsyncStorage)

---

## Designprinzipien

- Schlank und fokussiert – nur was der Nutzer wirklich braucht
- Keine Gamification, keine täglichen Quests, keine Streaks
- Deutsch als primäre Sprache der UI
- Farben: Protein = Blau (#4F8EF7), Kohlenhydrate = Orange (#F7A94F), Fett = Rot (#F74F4F)
- Hintergrund: #f5f5f5, Cards: weiß, Border-Radius: 16px

---

## Zielgruppe

Primär: Sportler und Fitness-affine Personen (18–30) die aktiv Makros tracken aber eine einfachere und intelligentere Lösung suchen als MyFitnessPal.

Kernproblem das gelöst wird: Der Nutzer weiß abends nicht was er noch essen soll um seine Makros zu treffen, und weiß nicht was er aus seinen vorhandenen Zutaten kochen kann.

---

## Wichtige Hinweise

- Expo Managed Workflow – kein Ejecting ohne guten Grund
- Node.js v24 auf Windows
- Testen ausschließlich über Expo Go auf physischem Gerät
- Noch kein Backend – alles läuft vorerst lokal auf dem Gerät
- Open Food Facts Basis-URL: https://world.openfoodfacts.org/api/v0/product/{barcode}.json
