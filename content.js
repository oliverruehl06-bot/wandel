'use strict';
/* Inhalte: Ernährungsformen, Beratung, Supplements, Wissen. Nur Daten, keine Logik. */

const DIET_PLANS = [
  {
    id: 'flex', name: 'Flexible Kalorienbilanz', short: 'Eiweißreich, nichts verboten, 80/20-Regel',
    who: 'Für alle, die Flexibilität brauchen und keine Lebensmittelgruppe streichen wollen. Beste Studienlage für gleichzeitigen Fettabbau und Muskelaufbau.',
    principle: 'Du hältst dein Kalorienziel ein und erreichst jeden Tag dein Eiweißziel. Etwa 80 % deiner Kalorien kommen aus wenig verarbeiteten Lebensmitteln, 20 % sind frei eingeplant. Kein Lebensmittel ist verboten, aber alles zählt.',
    macro: { fatPct: [25, 35] },
    rules: ['Eiweißziel hat jeden Tag Vorrang', 'Kalorienziel im Wochenschnitt einhalten', 'Jede Mahlzeit: Eiweißquelle plus Gemüse oder Obst', 'Öl, Butter, Nüsse und Soßen immer abwiegen', 'Keine Kalorien trinken', '80 % unverarbeitet, 20 % Genuss'],
    eat: {
      'Eiweiß': ['Hähnchen- und Putenbrust', 'Mageres Rind (Hüfte, Rinderhack 5 %)', 'Schweinefilet, Lachsschinken', 'Fisch: Lachs, Seelachs, Kabeljau, Thunfisch', 'Garnelen, Muscheln', 'Eier', 'Magerquark, Skyr, Hüttenkäse, Harzer', 'Tofu, Tempeh, Linsen, Kichererbsen', 'Proteinpulver'],
      'Gemüse (unbegrenzt)': ['Brokkoli, Blumenkohl, Zucchini', 'Paprika, Gurke, Tomate', 'Spinat, Salate, Rucola', 'Pilze, Spargel, grüne Bohnen', 'Möhren, Kohlrabi, Rotkohl', 'Tiefkühlgemüse (ungewürzt)'],
      'Obst': ['Beeren (frisch oder TK)', 'Äpfel, Birnen', 'Orangen, Mandarinen', 'Kiwi, Melone', 'Bananen (gut vor dem Training)'],
      'Kohlenhydrate': ['Kartoffeln, Süßkartoffeln', 'Reis, Basmati, Vollkornreis', 'Haferflocken', 'Vollkornbrot, Roggenbrot', 'Vollkornnudeln, Hülsenfrüchtenudeln', 'Wraps (Vollkorn)'],
      'Fette (abgewogen)': ['Olivenöl, Rapsöl', 'Nüsse, Mandeln (30 g)', 'Avocado', 'Leinsamen, Chiasamen', 'Erdnussmus (15 g)'],
      'Milchprodukte': ['Milch 1,5 %', 'Joghurt 1,5 %, Skyr', 'Käse light, Mozzarella light', 'Feta in Maßen'],
      'Getränke': ['Wasser, Sprudel', 'Kaffee, Tee ohne Zucker', 'Zero-Getränke in Maßen'],
      'Würzen': ['Kräuter, Gewürze, Senf', 'Essig, Zitronensaft', 'Sojasoße, Tomatenmark', 'Salsa, Light-Dressings']
    },
    limit: ['Weißbrot, Brötchen, Toast', 'Normale Nudeln (Portion abwiegen)', 'Käse über 30 % Fett', 'Wurst und Salami', 'Süßes, Kuchen, Eis (in die 20 % einplanen)', 'Chips, Knabberzeug', 'Alkohol (7 kcal pro g, hemmt Fettabbau)', 'Fertiggerichte'],
    avoid: ['Softdrinks, Säfte, Smoothies, Eistee', 'Frittiertes als Regel', 'Unkontrolliertes Snacken aus der Tüte', 'Sahnesoßen und Mayonnaise ohne Abwiegen'],
    tips: ['Koche Eiweiß für 2–3 Tage vor (Hähnchen, Hack, Eier).', 'Fülle den halben Teller mit Gemüse, dann bleibt weniger Platz.', 'Plane Genuss fest ein, statt ihn dir zu verbieten.', 'Iss langsam. Das Sättigungsgefühl kommt nach etwa 20 Minuten.'],
    sample: [['Mittag', 'Hähnchenbrust 200 g, Reis 70 g roh, großer Salat mit 1 TL Olivenöl'], ['Nachmittag', 'Skyr 300 g mit Beeren und 15 g Haferflocken'], ['Abend', 'Rinderhack 5 % 200 g als Chili mit Kidneybohnen, Paprika, Tomaten'], ['Spät (optional)', 'Magerquark 250 g mit etwas Süßstoff und Zimt']]
  },
  {
    id: 'med', name: 'Mittelmeerkost mit viel Eiweiß', short: 'Fisch, Gemüse, Olivenöl, Hülsenfrüchte',
    who: 'Für alle, die gern abwechslungsreich kochen und langfristig das Herz schützen wollen. Beste Evidenz für Gesundheit und Lebenserwartung.',
    principle: 'Viel Gemüse, Hülsenfrüchte, Fisch, Vollkorn und Olivenöl, wenig rotes Fleisch und Zucker. Für deinen Muskelaufbau ergänzen wir mehr Eiweiß als in der klassischen Variante.',
    macro: { fatPct: [30, 40] },
    rules: ['Fisch 2–3× pro Woche', 'Hülsenfrüchte 3× pro Woche', 'Olivenöl als Hauptfett, aber abgemessen', 'Rotes Fleisch höchstens 1× pro Woche', 'Eiweißziel über Fisch, Geflügel, Skyr und Hülsenfrüchte erreichen'],
    eat: {
      'Eiweiß': ['Lachs, Makrele, Sardinen, Thunfisch', 'Seelachs, Dorade, Garnelen', 'Hähnchen, Pute', 'Eier', 'Griechischer Joghurt 2 %, Skyr', 'Linsen, Kichererbsen, weiße Bohnen', 'Feta (light), Hüttenkäse'],
      'Gemüse (unbegrenzt)': ['Tomaten, Paprika, Zucchini, Aubergine', 'Spinat, Mangold, Rucola', 'Artischocken, Fenchel', 'Zwiebeln, Knoblauch', 'Brokkoli, grüne Bohnen'],
      'Obst': ['Beeren, Trauben in Maßen', 'Orangen, Granatapfel', 'Feigen (frisch)', 'Äpfel, Birnen'],
      'Kohlenhydrate': ['Vollkornbrot, Bulgur, Couscous (Vollkorn)', 'Kartoffeln', 'Vollkornnudeln', 'Gerste, Farro'],
      'Fette (abgemessen)': ['Olivenöl extra vergine (1 EL = 120 kcal)', 'Oliven', 'Walnüsse, Mandeln (30 g)', 'Avocado'],
      'Getränke': ['Wasser', 'Kaffee, Tee'],
      'Würzen': ['Basilikum, Oregano, Rosmarin, Thymian', 'Zitrone, Knoblauch', 'Kapern, Balsamico']
    },
    limit: ['Rotes Fleisch (Rind, Lamm)', 'Käse (Parmesan, Feta normal)', 'Weißmehlprodukte, Pizza', 'Wein (nicht nötig, beim Abnehmen kontraproduktiv)', 'Honig, Süßspeisen'],
    avoid: ['Wurst und verarbeitetes Fleisch', 'Softdrinks und Säfte', 'Fertiggerichte und Fast Food', 'Butter und Sahne als Hauptfett'],
    tips: ['Ofengemüse mit 1 EL Olivenöl und Fisch auf einem Blech spart Zeit.', 'Hülsenfrüchte aus der Dose abspülen und in Salate geben.', 'Öl mit einem Sprühfläschchen oder Teelöffel dosieren.'],
    sample: [['Mittag', 'Linsensalat mit Feta light, Tomate, Gurke, Hähnchen 150 g'], ['Nachmittag', 'Griechischer Joghurt 250 g mit Walnüssen 15 g und Beeren'], ['Abend', 'Lachs 180 g aus dem Ofen mit Zucchini, Paprika, Kartoffeln, 1 EL Olivenöl']]
  },
  {
    id: 'lc', name: 'Moderates Low Carb', short: '80–130 g Kohlenhydrate, viel Eiweiß',
    who: 'Für alle, die durch Brot, Nudeln und Süßes Heißhunger bekommen, oder bei erhöhtem Blutzucker. Kohlenhydrate bleiben rund ums Training erlaubt.',
    principle: 'Kohlenhydrate werden auf 80–130 g pro Tag begrenzt, Eiweiß bleibt hoch, Fett füllt den Rest. Die Kohlenhydrate legst du bevorzugt vor das Training.',
    macro: { carbMax: 130, carbMin: 80 },
    rules: ['Kohlenhydrate höchstens 130 g pro Tag', 'An Trainingstagen die meisten Kohlenhydrate 1–3 Stunden vor dem Training', 'Gemüse statt Beilage, Beilage nur einmal am Tag', 'Fett trotzdem abwiegen, sonst stimmen die Kalorien nicht'],
    eat: {
      'Eiweiß': ['Fleisch, Geflügel, Fisch', 'Eier', 'Magerquark, Skyr, Hüttenkäse', 'Käse in Maßen', 'Tofu'],
      'Gemüse (unbegrenzt)': ['Alle grünen Gemüse', 'Blumenkohl (auch als Reis-Ersatz)', 'Zucchini (auch als Nudel-Ersatz)', 'Pilze, Paprika, Tomaten', 'Salate'],
      'Obst': ['Beeren', 'Äpfel (vor dem Training)', 'Zitrusfrüchte'],
      'Kohlenhydrate (vor dem Training)': ['Kartoffeln, Reis, Haferflocken', 'Vollkornbrot', 'Bananen'],
      'Fette (abgewogen)': ['Olivenöl, Butter in Maßen', 'Nüsse, Samen', 'Avocado'],
      'Getränke': ['Wasser, Kaffee, Tee', 'Zero-Getränke']
    },
    limit: ['Brot, Nudeln, Reis zu Mahlzeiten ohne Training', 'Süße Früchte (Trauben, Mango, Bananen)', 'Hülsenfrüchte (gut, aber kohlenhydratreich)', 'Milch (Milchzucker)'],
    avoid: ['Zucker, Süßigkeiten, Softdrinks, Säfte', 'Weißmehlprodukte', '„Low-Carb"-Fertigprodukte als Ersatz für Süßes', 'Bier'],
    tips: ['Tausche Beilagen gegen eine doppelte Gemüseportion.', 'Low Carb ist keine Ausrede für unbegrenzt Käse und Nüsse.', 'In der ersten Woche fällt die Waage stark, das ist vor allem Wasser.'],
    sample: [['Mittag', 'Omelett aus 3 Eiern + 150 g Eiklar, Pilze, Spinat, 1 Scheibe Vollkornbrot'], ['Vor dem Training', 'Skyr 250 g mit 1 Banane'], ['Abend', 'Hähnchenschenkel ohne Haut 250 g, Brokkoli, Blumenkohlpüree']]
  },
  {
    id: 'lf', name: 'Fettarm und kohlenhydratreich', short: 'Große Portionen, Fett 20–25 %',
    who: 'Für alle, die gern große Portionen Kartoffeln, Reis und Gemüse essen und Fleisch, Käse und Nüsse leicht weglassen können.',
    principle: 'Fett ist am kalorienreichsten. Wird es reduziert, passen große, sättigende Portionen in dein Kalorienziel. Ein Minimum an Fett bleibt wichtig für Hormone.',
    macro: { fatPct: [20, 25], fatMinPerKg: 0.6 },
    rules: ['Fett 20–25 % der Kalorien, aber nicht unter dem Minimum', 'Stärkereiche Beilagen sind erlaubt und erwünscht', 'Magere Eiweißquellen wählen', 'Light-Produkte nur ohne zugesetzten Zucker'],
    eat: {
      'Eiweiß': ['Hähnchen, Pute, mageres Rind', 'Weißfisch, Garnelen', 'Magerquark, Skyr, Hüttenkäse', 'Eiklar, Eier in Maßen', 'Linsen, Bohnen, Erbsen'],
      'Gemüse (unbegrenzt)': ['Alle Gemüsesorten', 'Suppen auf Gemüsebasis'],
      'Obst': ['Alle Obstsorten'],
      'Kohlenhydrate': ['Kartoffeln (sehr sättigend)', 'Reis, Nudeln, Couscous', 'Haferflocken', 'Brot (Vollkorn)'],
      'Fette (Minimum)': ['1–2 TL Öl pro Tag', 'Ein paar Nüsse oder Leinsamen', 'Fetter Fisch 1–2× pro Woche'],
      'Getränke': ['Wasser, Kaffee, Tee']
    },
    limit: ['Eier (Eigelb), Käse', 'Nüsse, Avocado, Öl', 'Normale Milchprodukte (3,5 %)'],
    avoid: ['Frittiertes, Pommes, Chips', 'Sahne, Butter, Mayonnaise', 'Fette Wurst und fettes Fleisch', 'Fettreduzierte Fertigprodukte mit viel Zucker'],
    tips: ['Kartoffeln sättigen pro Kalorie stärker als fast jedes andere Lebensmittel.', 'Brate mit Spray-Öl oder in beschichteter Pfanne.', 'Achte darauf, dass Fett nicht unter das Minimum fällt.'],
    sample: [['Mittag', 'Putenbrust 200 g, Kartoffeln 400 g, Brokkoli'], ['Nachmittag', 'Magerquark 300 g mit Apfel und Zimt'], ['Abend', 'Seelachs 200 g, Reis 80 g roh, Gemüsepfanne']]
  },
  {
    id: 'veg', name: 'Vegetarisch, eiweißreich', short: 'Ohne Fleisch und Fisch, mit Ei und Milch',
    who: 'Für alle, die wenig oder kein Fleisch essen möchten. Mit Milchprodukten und Eiern ist das Eiweißziel gut erreichbar.',
    principle: 'Fleisch und Fisch fallen weg. Eiweiß kommt aus Milchprodukten, Eiern, Hülsenfrüchten, Soja und bei Bedarf Proteinpulver.',
    macro: { fatPct: [25, 35] },
    rules: ['Jede Mahlzeit mit einer starken Eiweißquelle (Skyr, Quark, Tofu, Eier)', 'Hülsenfrüchte täglich', 'Proteinpulver als feste Hilfe einplanen', 'Vegane Ersatzprodukte auf Kalorien und Eiweiß prüfen'],
    eat: {
      'Eiweiß': ['Skyr, Magerquark, Hüttenkäse, Harzer', 'Eier, Eiklar', 'Tofu, Tempeh, Seitan', 'Edamame, Linsen, Kichererbsen, Bohnen', 'Lupinen, Sojaschnetzel', 'Proteinpulver (Whey oder Erbse-Reis)'],
      'Gemüse (unbegrenzt)': ['Alle Gemüsesorten', 'Pilze als „fleischige" Komponente'],
      'Obst': ['Alle Obstsorten, bevorzugt Beeren und Äpfel'],
      'Kohlenhydrate': ['Kartoffeln, Reis, Haferflocken', 'Vollkornbrot, Vollkornnudeln', 'Linsennudeln, Kichererbsennudeln (viel Eiweiß)'],
      'Fette (abgewogen)': ['Olivenöl, Rapsöl', 'Nüsse, Samen, Erdnussmus', 'Leinöl (Omega-3)'],
      'Getränke': ['Wasser, Kaffee, Tee', 'Sojamilch (ungesüßt)']
    },
    limit: ['Käse (viel Fett)', 'Vegane Würstchen und Burger (oft fettreich)', 'Nüsse in großen Mengen'],
    avoid: ['Süßes und Weißmehl als „vegetarische" Hauptmahlzeit', 'Pasta mit Sahnesoße als Standard', 'Softdrinks und Säfte'],
    tips: ['Sojaschnetzel ersetzen Hackfleisch in Bolognese und Chili.', 'Skyr und Quark sind die günstigsten Eiweißquellen.', 'Lass Eisen, B12 und Vitamin D einmal im Jahr messen.'],
    sample: [['Mittag', 'Tofu 200 g aus der Pfanne, Reis 70 g roh, Gemüse, Erdnusssoße light'], ['Nachmittag', 'Skyr 300 g, Beeren, 1 Messlöffel Proteinpulver'], ['Abend', 'Chili sin Carne mit Sojaschnetzel 60 g, Kidneybohnen, Paprika']]
  },
  {
    id: 'keto', name: 'Ketogen', short: 'Unter 30 g Kohlenhydrate',
    who: 'Nur für Menschen, denen sehr klare Verbote leichter fallen als Mengenbegrenzung. Für Muskelaufbau und intensives Training nicht ideal.',
    principle: 'Kohlenhydrate werden so stark reduziert, dass der Körper Ketonkörper als Energie nutzt. Eiweiß bleibt hoch, der Rest kommt aus Fett.',
    macro: { carbMax: 30, carbMin: 0 },
    rules: ['Kohlenhydrate unter 30 g pro Tag', 'Elektrolyte: Salz, Kalium, Magnesium gegen die „Keto-Grippe"', 'Fett nicht unbegrenzt, Kalorien zählen weiterhin', 'Viel grünes Gemüse für Ballaststoffe'],
    eat: {
      'Eiweiß': ['Fleisch, Geflügel, Fisch', 'Eier', 'Käse, Quark, griechischer Joghurt (natur)'],
      'Gemüse': ['Spinat, Salat, Brokkoli, Blumenkohl', 'Zucchini, Gurke, Pilze, Spargel'],
      'Fette': ['Olivenöl, Butter, Avocado', 'Nüsse (Macadamia, Walnuss), Samen'],
      'Getränke': ['Wasser (mit etwas Salz), Kaffee, Tee']
    },
    limit: ['Beeren (kleine Mengen)', 'Milch, Joghurt (Milchzucker)', 'Nüsse (Kalorien und Kohlenhydrate)'],
    avoid: ['Brot, Nudeln, Reis, Kartoffeln, Haferflocken', 'Obst außer wenigen Beeren', 'Hülsenfrüchte', 'Zucker in jeder Form, Bier'],
    tips: ['Rechne mit Leistungseinbußen im Training in den ersten 2–4 Wochen.', 'Lass Blutfette (LDL) nach 3 Monaten kontrollieren.', 'Wenn es dir schwerfällt, wechsle zu moderatem Low Carb.'],
    sample: [['Mittag', 'Rührei aus 4 Eiern mit Spinat und Lachs 100 g'], ['Nachmittag', 'Griechischer Joghurt 200 g mit Walnüssen 15 g'], ['Abend', 'Rindersteak 200 g, Brokkoli mit Butter 10 g, Salat']]
  }
];

const ADDONS = {
  tre: { name: 'Essensfenster (z. B. 12–20 Uhr)', text: 'Du isst nur in einem Fenster von 8–10 Stunden, zum Beispiel von 12 bis 20 Uhr. Das spart keine Kalorien von selbst, macht das Einhalten aber für viele leichter, besonders ohne Frühstückshunger. Im Fenster trotzdem 2–3 eiweißreiche Mahlzeiten.' },
  dash: { name: 'Salzarm (DASH-Prinzip)', text: 'Weniger als 5–6 g Salz pro Tag, mehr Gemüse, Obst, fettarme Milchprodukte und Hülsenfrüchte. Senkt erhöhten Blutdruck nachweislich innerhalb weniger Wochen. Größte Salzquellen: Brot, Wurst, Käse, Fertiggerichte, Fertigsoßen.' }
};

/* Beratung: Fragen mit Punktwerten je Ernährungsform */
const QUIZ = [
  { id: 'meals', q: 'Wie viele Mahlzeiten schaffst du im Alltag realistisch?', a: [['1', 'Eine'], ['2', 'Zwei'], ['3', 'Drei'], ['4', 'Vier oder mehr']] },
  { id: 'morning', q: 'Hast du morgens Hunger?', a: [['no', 'Nein, frühestens mittags'], ['yes', 'Ja, ich frühstücke gern']] },
  { id: 'struggle', q: 'Was fällt dir beim Essen am schwersten?', a: [['sweets', 'Süßes und Snacks'], ['volume', 'Hunger, ich brauche große Portionen'], ['evening', 'Abends viel essen'], ['time', 'Zeit zum Kochen']] },
  { id: 'meat', q: 'Isst du Fleisch und Fisch?', a: [['all', 'Ja, gern'], ['some', 'Wenig Fleisch, eher Fisch und Geflügel'], ['veg', 'Nein, lieber vegetarisch']] },
  { id: 'taste', q: 'Worauf könntest du am wenigsten verzichten?', a: [['carbs', 'Brot, Nudeln, Reis, Kartoffeln'], ['fat', 'Fleisch, Käse, Eier, Nüsse'], ['both', 'Keins von beidem, ich mag Abwechslung']] },
  { id: 'health', q: 'Ist bei dir etwas bekannt?', multi: true, a: [['bp', 'Bluthochdruck'], ['sugar', 'Erhöhter Blutzucker oder Prädiabetes'], ['lipids', 'Erhöhte Blutfette'], ['none', 'Nichts bekannt oder nicht gemessen']] },
  { id: 'cook', q: 'Wie gern kochst du?', a: [['little', 'Kaum, es muss schnell gehen'], ['some', 'Ein paar Mal pro Woche'], ['love', 'Gern und abwechslungsreich']] },
  { id: 'rules', q: 'Was hilft dir mehr?', a: [['strict', 'Klare Verbote, dann muss ich nicht nachdenken'], ['flex', 'Flexibilität, Verbote machen mich verrückt']] }
];

const MEALS_ADVICE = {
  title: 'Wie viele Mahlzeiten?',
  points: [
    'Für das Abnehmen selbst ist die Anzahl der Mahlzeiten egal. Studien finden bei gleichen Kalorien keinen Unterschied zwischen 1, 3 oder 6 Mahlzeiten.',
    'Für den Muskelaufbau nicht: Der Körper baut Muskeleiweiß am besten auf, wenn Eiweiß auf 3–4 Portionen mit je etwa 0,4 g pro kg verteilt ist. Bei dir sind das 35–50 g pro Mahlzeit.',
    'Mit nur einer Mahlzeit am Tag sind 160 g Eiweiß kaum zu schaffen, und auf einmal gegessene 2.000 kcal machen träge und fördern Heißhunger.',
    'Deine Empfehlung: Schritt 1 (ab sofort) sind 2 Mahlzeiten plus ein Eiweißsnack wie Skyr, Quark oder ein Shake. Schritt 2 (nach 2–3 Wochen) sind 3 Mahlzeiten.',
    'Ohne Frühstückshunger musst du nicht frühstücken. Lege die Mahlzeiten in ein Fenster, z. B. 12, 16 und 19:30 Uhr.',
    'An Trainingstagen eine Mahlzeit 1–3 Stunden vor dem Training und eine danach einplanen.'
  ]
};

const CHEAT = {
  points: [
    'Am Tag nach einem Cheat Day zeigt die Waage oft 1–3 kg mehr. Das ist Wasser, Salz, Glykogen und Darminhalt, kein Fett. Es verschwindet in 2–4 Tagen.',
    'Echter Fettzuwachs entsteht nur aus dem Überschuss über deinem Verbrauch. Rund 7.700 kcal Überschuss ergeben etwa 1 kg Fett.',
    'Das eigentliche Problem: Ein großer Cheat Day löscht schnell das Defizit von 3–5 Tagen. Wer jede Woche einen macht, nimmt kaum noch ab.',
    'Die Theorie, ein „Refeed" kurbele den Stoffwechsel an, ist für Menschen mit viel Körperfett nicht belegt. Besser belegt sind Diätpausen: alle 10–12 Wochen eine Woche auf Erhaltungskalorien.',
    'Wenn ein Cheat Day bei dir zu Kontrollverlust führt, also Essanfällen oder „heute ist eh alles egal", ist eine tägliche kleine Genussportion die bessere Wahl.'
  ],
  rec: 'Empfehlung: statt eines Cheat Days eine geplante Genussmahlzeit pro Woche. Beginne sie mit Eiweiß und halte sie bei etwa 500–800 kcal über deinem normalen Ziel. Wer sie einplant, isst an 2–3 anderen Tagen je 200 kcal weniger. So bleibt die Woche im Plan.'
};

const SUPPS = [
  { s: 's5', name: 'Kreatin-Monohydrat', what: 'Mehr Kraft und Wiederholungen, dadurch mehr Muskelaufbau. Eines der am besten erforschten Supplements überhaupt, sicher bei gesunden Nieren.', dose: '3–5 g täglich, Zeitpunkt egal, auch an trainingsfreien Tagen. Keine Ladephase nötig. Nur Monohydrat, am besten mit „Creapure"-Siegel. Andere Formen sind teurer und nicht besser.' },
  { s: 's5', name: 'Proteinpulver (Whey oder Mehrkomponenten)', what: 'Kein Wirkstoff, sondern bequemes Eiweiß. Hilft, 160–180 g pro Tag zu erreichen.', dose: '1–2 Portionen (25–40 g Eiweiß), wenn du das Ziel mit Essen nicht schaffst. Vegetarisch: Whey. Vegan: Erbse-Reis-Mischung.' },
  { s: 's3', name: 'Vitamin D3', what: 'Muskelfunktion, Knochen, Immunsystem. Bei Übergewicht und im Winter sehr häufig ein Mangel.', dose: 'Erst Blutwert (25-OH-D) messen lassen. Bei Mangel meist 1.000–4.000 IE täglich zu einer fetthaltigen Mahlzeit, nach Arztempfehlung.' },
  { s: 's3', name: 'Omega-3 (EPA/DHA)', what: 'Senkt Triglyzeride, unterstützt Herz und Gefäße. Für Muskelaufbau nur schwache Daten.', dose: '1–2 g EPA+DHA täglich, wenn du weniger als 2× pro Woche fetten Fisch isst. Algenöl ist die vegane Variante.' },
  { s: 's3', name: 'Koffein', what: 'Mehr Leistung und Konzentration im Training. Gut belegt.', dose: '3 mg pro kg (etwa 1–2 Tassen Kaffee) 30–60 Minuten vor dem Training. Nicht nach 14 Uhr, sonst leidet der Schlaf.' },
  { s: 's2', name: 'Magnesium, Eisen, Zink, B12, Jod', what: 'Nur sinnvoll bei nachgewiesenem Mangel oder veganer Ernährung (dann B12 immer).', dose: 'Blutbild machen lassen. Eisen nie ohne Messung einnehmen.' },
  { s: 's0', name: 'Fatburner, L-Carnitin, CLA, Grüntee-Extrakt, Garcinia, Himbeerketone', what: 'Kein relevanter Effekt auf den Fettabbau nachgewiesen. Grüntee-Extrakt kann in hohen Dosen die Leber schädigen.', dose: 'Geld sparen.' },
  { s: 's0', name: 'BCAAs, EAAs, Glutamin', what: 'Bei 160 g Eiweiß pro Tag ohne Zusatznutzen. Das Eiweiß in deinem Essen enthält diese Aminosäuren schon.', dose: 'Geld sparen.' },
  { s: 's0', name: 'Testo-Booster, Tribulus, „Anabol"-Pflanzenextrakte', what: 'Kein Effekt auf Testosteron oder Muskeln bei gesunden Männern. Teils mit verbotenen Stoffen verunreinigt.', dose: 'Finger weg.' },
  { s: 's0', name: 'Detox, Entwässerungstabletten, Kollagen gegen lose Haut', what: 'Detox ist Marketing. Für Kollagen gibt es schwache Hinweise auf Hautelastizität, aber nichts zu loser Haut nach Gewichtsverlust.', dose: 'Kein Nutzen für dein Ziel.' }
];
const SUPP_LABEL = { s5: ['c-go', 'Starke Evidenz'], s3: ['c-acc', 'Gute Evidenz, situativ'], s2: ['c-warn', 'Nur bei Mangel'], s0: ['c-bad', 'Nutzlos'] };
/* Supplements, die je Ernährungsform zusätzlich empfohlen werden */
const DIET_SUPPS = { flex: ['Kreatin-Monohydrat', 'Vitamin D3'], med: ['Kreatin-Monohydrat', 'Vitamin D3'], lc: ['Kreatin-Monohydrat', 'Vitamin D3', 'Magnesium (bei Krämpfen)'], lf: ['Kreatin-Monohydrat', 'Vitamin D3', 'Omega-3 (EPA/DHA)'], veg: ['Kreatin-Monohydrat (bei Vegetariern besonders wirksam)', 'Vitamin D3', 'Proteinpulver', 'Omega-3 aus Algenöl', 'B12 (bei wenig Ei und Milch)'], keto: ['Kreatin-Monohydrat', 'Vitamin D3', 'Elektrolyte (Natrium, Kalium, Magnesium)'] };

const KNOW_TRAINING = [
  ['Nah ans Versagen', 'Beende jeden Satz, wenn noch 1–3 saubere Wiederholungen gingen. Diese Zahl heißt RIR (Wiederholungen in Reserve).'],
  ['Leicht oder schwer?', 'Für Muskelaufbau ist beides ähnlich gut, solange die Sätze hart sind. Empfehlung: Grundübungen 6–12, Isolationsübungen 10–20 Wiederholungen. Sehr schwere Gewichte (1–5 Wdh.) belasten am Anfang unnötig Gelenke und Sehnen.'],
  ['Steigerung', 'Erst die Wiederholungen bis zum oberen Ende der Spanne steigern, dann das Gewicht um einen Gewichtssprung erhöhen. Die App schlägt dir das bei jeder Übung vor.'],
  ['Menge', 'Starte mit etwa 10 harten Sätzen pro Muskel und Woche, später 12–20.'],
  ['Beine nur 1× pro Woche', 'Plane am Beintag 10–12 Sätze für Beine und Po. Ein bis zwei Beinübungen an den Oberkörpertagen helfen zusätzlich. Bei deiner Fehlstellung sind geführte Maschinen (Beinpresse, Beinbeuger, Beinstrecker) meist gut verträglich.'],
  ['Technik vor Gewicht', 'Kontrolliert ablassen (2–3 Sekunden), volle Bewegung, kein Schwung.'],
  ['Entlastung', 'Alle 6–8 Wochen eine leichtere Woche mit halber Satzzahl.'],
  ['Kein Cardio nötig', 'Abnehmen passiert über die Ernährung. Cardio ist ein Bonus. Bewegung im Alltag hilft, aber nur so viel, wie deine Beine gut mitmachen.']
];
const KNOW_SKIN = [
  ['Was lose Haut beeinflusst', 'Menge des Gewichtsverlusts, Alter, Genetik, Dauer des Übergewichts, Rauchen und Sonnenschäden. Mit 30 hast du noch deutlich elastischere Haut als mit 45.'],
  ['Was du tun kannst', 'Muskeln aufbauen (füllen die Haut von innen), genug Eiweiß, nicht rauchen, Sonnenschutz, viel trinken, kein Crash-Diäten.'],
  ['Tempo', 'Ziel sind 0,5–1 % deines Körpergewichts pro Woche. Die App warnt dich, wenn du schneller wirst. Viel langsamer ist nicht automatisch besser, sondern verlängert nur die Zeit, die du durchhalten musst.'],
  ['Ehrlich gesagt', 'Bei 35–40 kg Gewichtsverlust lässt sich lose Haut nicht garantiert verhindern. Viele Menschen haben nach 1–2 Jahren deutlich weniger davon als direkt nach dem Abnehmen, weil sich die Haut teilweise zurückbildet.']
];
