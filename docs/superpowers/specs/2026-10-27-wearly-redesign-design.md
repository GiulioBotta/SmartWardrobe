# Wearly: nuova grafica e semplificazione dell'interfaccia

Data: 2026-10-27 · Stato: implementato (branch feat/wearly-redesign) · Repo: SmartWardrobe (fork di Wardrowbe, Next.js 14 + Tailwind + shadcn/ui)

## Perché

L'app oggi ha ancora nome, logo e aspetto di Wardrowbe, e mostra molte funzioni che l'utente non ha chiesto
(famiglia, apprendimento IA, abbinamenti…). Entrando nel cruscotto compare un errore incomprensibile
("You're not in a family"). L'utente vuole un'app **sua**: più bella, più personale, più semplice, con
un'atmosfera calda e accogliente. La userà soprattutto dal telefono, ogni mattina, per decidere e registrare
cosa indossa.

## Obiettivi

1. **Identità nuova:** nome provvisorio **Wearly**, logo nuovo, stile "Caffè e crema" con colore guida moka calda,
   tema chiaro e tema scuro coerenti.
2. **Meno funzioni in vista:** restano solo quelle che servono all'uso quotidiano; le altre vengono nascoste.
3. **Si apre su "Oggi":** la schermata iniziale è la domanda del giorno ("cosa indossi oggi?") e assorbe il cruscotto.
4. **Menu semplice:** Oggi · Armadio · Outfit · Altro, uguale su telefono (barra in basso) e computer (colonna a sinistra).
5. **Pagine quotidiane:** Oggi ridisegnata da zero (con menu e logo); Armadio con la scheda del capo, Suggerisci e
   Outfit **rifinite** (vedi "Profondità del ridisegno").

## Non obiettivi (fuori da questo lavoro)

- Aggiunta di capi da un link o da una foto presa da internet: **progetto successivo**, separato.
- Il nome definitivo e originale (Wearly è già usato da altre app dello stesso tipo): si sceglierà più avanti.
  Per questo il nome deve stare in **un solo punto** del codice, facile da cambiare.
- Modifiche al backend: non servono. Le funzioni nascoste restano attive nel server.
- Ridisegno profondo delle pagine secondarie (Analisi, Impostazioni, Da rivedere, Studio, login, onboarding):
  prendono solo i nuovi colori, caratteri e il logo.
- Traduzioni complete nelle altre lingue: si scrivono italiano e inglese; le altre 6 lingue ricevono il testo inglese
  (stessa scelta fatta per le pagine Suggerisci, Da rivedere e Oggi).

## Anti-obiettivi (sarebbe un fallimento anche se funziona)

- Un'app che sembra fredda, grigia o "da gestionale": l'utente ha scartato toni freddi (anche la tortora pura) e il
  caramello/arancio.
- Funzioni cancellate per davvero: l'utente vuole poterle riaccendere. **Nascondere, non eliminare.**
- Un rifacimento che rende impossibile prendere gli aggiornamenti del **backend** di Wardrowbe.
- Pagine rotte o test originali disattivati per far passare la build.

## Decisioni prese con l'utente

### Stile "Caffè e crema", colore guida moka calda

Ispirazione: rivista di moda, ma accogliente. Tanto spazio, foto dei capi grandi, poche decorazioni.

| Ruolo | Chiaro | Scuro ("a luci spente") |
|---|---|---|
| Fondo pagina | `#f8f1e7` crema | `#241a15` espresso |
| Riquadri foto / superfici secondarie | `#efe3d3` beige | `#322520` |
| Testo principale | `#3b2a20` caffè | `#f3e8da` crema |
| Testo secondario | `#8a6a52` | `#b59b86` |
| Bordi / linee | `#d8c6b2` | `#4a3a30` |
| **Colore guida** (voce attiva, filtri attivi, dettagli) | `#8f705c` moka calda | `#cdac94` moka chiaro |
| Pulsante principale | fondo `#3b2a20`, testo `#f8f1e7` | fondo `#f3e8da`, testo `#241a15` |

Sono i valori visti e scelti dall'utente nelle bozze (`.superpowers/brainstorm/`, file `moka-warm.html`, variante 3a).
Il tema segue il sistema (impostazione attuale `defaultTheme="system"`) e si può cambiare a mano come oggi.

### Caratteri

- Titoli: carattere **con grazie** "da rivista". Nelle bozze era Georgia.
- Dettagli piccoli (marca, materiale, etichette): **maiuscoletto spaziato** (maiuscolo, lettere distanziate, corpo piccolo).
- Testi lunghi, moduli, pulsanti: carattere senza grazie (proposta accettata dall'utente: si legge meglio sul telefono).

### Nome e logo

- Nome provvisorio: **Wearly**.
- Logo: **cassettone stilizzato** (rettangolo arrotondato diviso in due cassetti, ciascuno con una maniglia), tratto
  color crema su quadrato caffè con angoli arrotondati. È l'icona dell'app, la favicon e il marchio in cima al menu.
  Disegno di riferimento (SVG, viewBox 40×40):
  `<rect x="7" y="9" width="26" height="22" rx="3"/><path d="M7 20 H33"/><path d="M17 14.5 H23"/><path d="M17 25.5 H23"/>`
  con `stroke="#f3e8da" stroke-width="2.4" stroke-linecap="round" fill="none"` su fondo `#3b2a20`.

### Funzioni: cosa resta, cosa si nasconde

**Restano in vista**
- **Oggi** (nuova schermata iniziale, vedi sotto).
- **Armadio** (i capi; da qui si aggiungono capi).
- **Outfit**: look salvati e indossati, con dentro anche la **Cronologia** dei suggerimenti passati (oggi è una pagina a sé).
- **Suggerisci**: raggiunta dal pulsante "Proponimi un outfit" in Oggi (non è più una voce del menu).
- In **Altro**: **Da rivedere** (caricamento in blocco), **Analisi** (statistiche, tenuta ma "più in basso"),
  **Impostazioni**.
- **Lavaggi**: restano (avviso "da lavare" sui capi).
- **Notifiche giornaliere** (email / ntfy): **non spariscono**, diventano una **sezione dentro Impostazioni**.

**Nascoste** (codice intatto, non raggiungibili dal menu né dalle pagine visibili)
- Famiglia e Feed Famiglia (e con loro il messaggio "You're not in a family" nel cruscotto).
- Pagina Apprendimento IA (l'apprendimento dai voti continua a funzionare nel server).
- Abbinamenti (lo stesso risultato si ottiene in Suggerisci fissando un capo).
- Nelle Impostazioni: Endpoint IA, Misure del corpo.

### Navigazione

- Menu: **Oggi · Armadio · Outfit · Altro**. "Altro" raccoglie Da rivedere, Analisi, Impostazioni.
- Telefono: barra in basso con queste quattro voci (sostituisce l'attuale barra a 5 voci).
- Computer: colonna a sinistra con le stesse voci; le tre di "Altro" possono stare visibili sotto, separate.
- L'app si apre su **Oggi**: dopo il login e alla radice dell'area riservata.

### Schermata "Oggi" (sostituisce il cruscotto)

Dall'alto (bozza `home-nav.html`, variante A):
1. Saluto con il nome dell'utente, giorno e meteo in breve ("martedì · 13° soleggiato").
2. Riquadro **"Cosa indossi oggi?"**:
   - se non hai ancora registrato niente: pulsante principale **Proponimi un outfit** (porta a Suggerisci) e due
     pulsanti secondari **Scelgo io** (griglia dei capi) e **Rimetti un look** (outfit recenti);
   - se hai già registrato: l'outfit di oggi in miniatura, con la possibilità di aggiungerne un altro.
3. **Indossati di recente** (miniature).
4. Promemoria **"N capi da rivedere"** se ci sono caricamenti in attesa, con collegamento a Da rivedere.

La pagina `/dashboard/today` costruita nel task 8 (griglia per categoria, rimetti un look, già registrato oggi) è il
punto di partenza: le sue funzioni finiscono qui o in schermate raggiunte da qui.

### Come si costruisce (scelta concordata)

**"La grafica va per la sua strada, il motore resta vicino a Wardrowbe."**
1. Colori, caratteri e tema scuro nei **file centrali dello stile** (variabili in `frontend/app/globals.css`,
   `frontend/tailwind.config.js`, caratteri in `frontend/app/layout.tsx`): tutte le pagine, anche quelle non toccate,
   prendono subito il nuovo aspetto.
2. **Pezzi nuovi**: logo, menu, schermata Oggi.
3. **Oggi** ridisegnata da zero; **Armadio + scheda del capo, Suggerisci, Outfit (con Cronologia) rifiniti**.
4. Le funzioni tolte vengono **nascoste**, non cancellate.
5. Backend: nessuna modifica. Il frontend può divergere da Wardrowbe; il backend resta vicino all'originale per
   continuare a ricevere gli aggiornamenti.

### Profondità del ridisegno (deciso con l'utente)

**Rifinitura, non ripensamento**, per Armadio + scheda del capo, Suggerisci e Outfit: restano **tutte le funzioni e i
controlli di oggi** (filtri, ricerca, selezione multipla e barra delle azioni in blocco, capi fissati, scambio di un capo,
"Lo metto oggi", lavaggi, foto extra, rimozione sfondo, Studio). Cambiano aspetto, gerarchia e spazi: nuovi colori e
caratteri, foto dei capi più grandi, titoli con grazie, dettagli in maiuscoletto, controlli secondari meno in evidenza,
ordine più pulito, buona resa a 375 px. Non servono bozze di queste pagine.
Motivo: l'utente sta per iniziare due settimane di uso reale con tutto l'armadio; un ripensamento delle singole pagine
si farà dopo, con le bozze, solo dove l'uso avrà mostrato attriti.

### Scelte prese da Claude dopo la revisione (da verificare in lettura)

- **Riaccendere le funzioni nascoste** = un file di configurazione del frontend (elenco delle sezioni attive), modificato
  da chi sviluppa. Nessun interruttore dentro l'app: richiederebbe di salvare la scelta da qualche parte e non serve
  all'uso personale.
- **Ingressi alle funzioni nascoste dentro le pagine visibili** (per esempio "Trova abbinamenti" nella scheda del capo
  o nella pagina Outfit) si nascondono con la stessa configurazione. Riaccendendo la funzione, tornano.
- **Cosa succede alle schede del vecchio cruscotto:**
  - gli **outfit in attesa** creati dalle notifiche giornaliere (accetta/scarta) finiscono **dentro "Cosa indossi
    oggi?"** in Oggi: se c'è un outfit proposto per oggi, compare lì con "Lo metto oggi" e "Scarta";
  - "prossima notifica programmata" e "stato dei canali" vanno nella sezione Notifiche delle Impostazioni;
  - il riepilogo settimanale va in Analisi;
  - azioni rapide e approfondimenti del cruscotto spariscono (le stesse cose sono raggiungibili dal menu).
- **Indirizzi vecchi** (`/dashboard/history`, `/dashboard/notifications`, pagine nascoste) restano validi come
  reindirizzamenti verso la nuova posizione o verso Oggi, perché i link nelle notifiche del backend puntano lì.
- **Oggi vive in `/dashboard`** (radice dell'area riservata); `/dashboard/today` reindirizza lì.

## Vincoli

- Next.js 14 + Tailwind + shadcn/ui già presenti: niente nuove librerie pesanti. Il progetto già scarica Inter da
  Google Fonts con `next/font`, quindi un carattere con grazie da Google Fonts è accettabile.
- Le pagine devono funzionare a 375 px di larghezza (telefono) senza scorrimento orizzontale; la barra in basso del
  telefono non deve coprire i contenuti (problema già incontrato e risolto in Da rivedere e Oggi).
- Contrasto leggibile in entrambi i temi (testo secondario incluso).
- Tutte le suite devono restare verdi: backend (pytest), frontend (vitest), E2E (Playwright in `e2e/`).
  I test originali che controllano testi o voci di menu cambiati vanno aggiornati, non disattivati.
- Testi: italiano ed inglese scritti, altre lingue con il testo inglese.
- Convenzioni del repo (CLAUDE.md): rispondere in italiano, commit solo su richiesta, modifiche minime al backend.
- Mac M1 con 8 GB di RAM: il frontend dev arriva già a ~870 MB, evitare dipendenze che lo appesantiscano.

## Lasciato a chi costruisce

- Quale carattere con grazie preciso usare (simile a Georgia; per esempio Gelasio, che ha le stesse misure di Georgia),
  e quale senza grazie (Inter, già presente, va bene).
- Come rendere "nascoste" le funzioni: per esempio un file di configurazione del frontend con l'elenco delle sezioni
  attive, che menu, cruscotto e impostazioni rispettano; le pagine nascoste possono reindirizzare a Oggi se aperte
  da un indirizzo diretto.
- Dove mettere esattamente la costante del nome dell'app e le icone (favicon, icone PNG in `frontend/public/`,
  icona per la schermata Home del telefono).
- "Altro" sul telefono: pagina a sé o pannello che sale dal basso.
- Raggi degli angoli, spaziature, ombre, dettagli dei componenti, purché coerenti con le bozze.
- Ordine di lavoro e suddivisione in commit.
- Come unire Cronologia dentro Outfit (scheda, filtro o sezione).

## Riferimenti

- Bozze viste dall'utente: `.superpowers/brainstorm/34679-1793131658/content/` (`visual-style*.html`,
  `accent-and-dark.html`, `moka-warm.html`, `name-*.html`, `home-nav.html`). Cartella non versionata.
- Pagine e componenti attuali: `frontend/app/dashboard/*`, `frontend/components/sidebar.tsx`,
  `mobile-sidebar.tsx`, `mobile-nav.tsx`, `header.tsx`, `frontend/app/dashboard/page.tsx` (cruscotto).
- Funzioni costruite nel fork: `docs/fork-notes.md`, CLAUDE.md.
