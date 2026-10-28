# Armadio diviso per categorie, con raccolte e ordine personalizzabile

Data: 2026-10-28 · Stato: approvato · Bozze grafiche approvate: `.superpowers/brainstorm/6235-1793187539/content/armadio-categorie.html`

## Perché

Oggi l'Armadio è una griglia unica ordinata per data. Con 50–100 capi diventa difficile trovare "i pantaloni" o vedere a colpo d'occhio cosa si ha. L'utente vuole che l'Armadio sia **diviso per categorie per impostazione predefinita**, con il nome della categoria come separatore, e che sia lui a decidere **l'ordine delle categorie**.

Le categorie standard sono pensate sull'armadio dell'utente (uomo), ma l'app non deve chiedere il sesso: per gli altri ci sono **categorie pronte nascoste** da accendere, e **raccolte create dall'utente** con nome libero.

## Cosa si vede (dalle bozze approvate)

1. **Armadio raggruppato.** Ogni gruppo ha un titolo (serif, stile Wearly) con il numero di capi; toccando il titolo il gruppo si chiude o si riapre. Ricerca, filtri e menu di ordinamento restano sopra i gruppi e valgono dentro ogni gruppo. Le raccolte hanno un'icona a segnalibro accanto al titolo. I gruppi vuoti (anche per effetto di un filtro) non compaiono.
2. **Finestra "Organizza"** (pulsante in alto nell'Armadio): una sola lista con categorie e raccolte, riordinabile trascinando (maniglia) o con frecce su/giù; sotto, "Altre categorie pronte" con un interruttore ciascuna; pulsanti "Nuova raccolta" e "Ripristina ordine". Le raccolte hanno anche rinomina ed eliminazione.
3. **Nuova raccolta**: nome + galleria di tutti i capi da toccare per selezionarli, pulsante "Crea con N capi".
4. **Dalla selezione multipla dell'Armadio** (barra in basso, esiste già): azioni nuove "Nuova raccolta" (crea una raccolta con i capi selezionati) e "Aggiungi a…" (sceglie una raccolta esistente). Dentro un gruppo-raccolta c'è anche "Togli dalla raccolta".

Richiesta esplicita dell'utente: **tutto ben ordinato e icone coerenti con lo stile** (Caffè e crema, `font-serif` per i titoli, `label-caps`, token `--brand`). Le emoji delle bozze vanno sostituite con icone lucide-react già usate nell'app (es. `Bookmark`, `GripVertical`, `ChevronDown`, `ArrowUp`/`ArrowDown`, `Pencil`, `Trash2`, `Plus`, `RotateCcw`) e con il componente interruttore dell'app.

## Regole

### Tre tipi di gruppi
- **Categorie standard**, sempre presenti (si possono riordinare, non spegnere né cancellare):
  Magliette e camicie · Felpe e maglioni · Giacche · Pantaloni · Scarpe e stivali · Accessori.
- **Categorie pronte nascoste**, spente di default, accendibili: Gonne · Vestiti · Completi · Borse · Calze e collant. (Elenco approvato dall'utente.)
- **Raccolte dell'utente**: nome libero (l'utente non vuole "cartelle" né "categorie personalizzate"; "Raccolte" è scelta di Claude, è solo un testo tradotto e si cambia facilmente), riempite a mano. Un capo in una raccolta **resta anche nella sua categoria** (compare due volte nella pagina) e può stare in più raccolte.

Più un gruppo di servizio **"Da sistemare"**, sempre in fondo, non spostabile, visibile solo se contiene qualcosa: capi senza tipo (`unknown`) o con un tipo che nessuna categoria attiva accoglie.

### Da tipo a categoria (automatico, scelta di Claude)
| Categoria | Tipi del vocabolario |
|---|---|
| Magliette e camicie | shirt, t-shirt, top, polo, blouse, tank-top |
| Felpe e maglioni | sweater, hoodie, cardigan, vest |
| Giacche | jacket, coat, blazer |
| Pantaloni | pants, jeans, shorts |
| Scarpe e stivali | shoes, sneakers, boots, sandals |
| Accessori | hat, scarf, belt, tie, accessories |
| Gonne *(nascosta)* | skirt — se spenta → Pantaloni |
| Vestiti *(nascosta)* | dress, jumpsuit — se spenta → Da sistemare |
| Completi *(nascosta)* | suit — se spenta → Giacche |
| Borse *(nascosta)* | bag — se spenta → Accessori |
| Calze e collant *(nascosta)* | socks, tights — se spenta → Accessori |

La categoria dipende **solo dal tipo**: se l'analisi sbaglia, l'utente corregge il tipo a mano (campo già presente nel modulo di modifica) e il capo cambia gruppo da solo. Nessuno smistamento manuale nelle categorie.

Nella finestra Organizza, una categoria nascosta che conterrebbe capi mostra il numero ("3 capi") per invitare ad accenderla.

**Importante:** le categorie servono solo a mostrare e ordinare l'Armadio. **Non cambiano** la logica degli outfit (`ITEM_ROLE`, slot, punteggi): per esempio `hoodie` resta uno strato esterno per le proposte anche se compare in "Felpe e maglioni".

L'utente ha segnalato un problema proprio lì, da affrontare **come lavoro separato, subito dopo questo**: con il freddo una felpa o un maglione non deve valere come strato esterno; l'outfit deve includere anche una giacca (che poi si può togliere). Lui in inverno porta sempre una giacca sopra felpe e maglioni. Questo progetto non tocca la logica degli outfit.

### Ordine e stato
- L'ordine di categorie e raccolte è **uno solo, misto**, scelto dall'utente; una raccolta può stare anche in cima. Ordine iniziale: Magliette e camicie, Felpe e maglioni, Giacche, Pantaloni, Scarpe e stivali, Accessori; le categorie accese e le raccolte nuove si aggiungono in fondo (prima di "Da sistemare").
- "Ripristina ordine" rimette l'ordine iniziale per le categorie; le raccolte restano, in fondo nell'ordine di creazione.
- Ordine, categorie accese e raccolte si salvano **sull'account** (uguali su Mac e telefono).
- Gruppi chiusi/aperti: salvati **sul dispositivo** (`localStorage`, con try/catch), scelta di Claude.

### Raccolte
- Nome obbligatorio, max 50 caratteri, unico per utente (senza distinzione maiuscole/minuscole).
- Eliminare una raccolta **non elimina i capi**. Eliminare un capo lo toglie dalle raccolte (cancellazione a cascata). Un capo **archiviato** resta collegato alle sue raccolte ma non compare (si filtra in lettura, come oggi per l'Armadio); se viene ripristinato torna nelle sue raccolte. Scelta di Claude: nessun aggancio nel codice originale di archiviazione.
- Selezione multipla: un capo che compare due volte (categoria e raccolta) è **un solo capo**. Selezionarlo in un gruppo lo seleziona anche nell'altro, e nei conteggi ("Crea con N capi", "N selezionati") vale uno. Scelta di Claude.
- Una raccolta vuota resta nella finestra Organizza ma non compare nell'Armadio (come gli altri gruppi vuoti).
- Nella scheda del capo, una riga "Raccolte" con i nomi e la possibilità di aggiungerlo/toglierlo (scelta di Claude: comoda e piccola).

### Vista raggruppata
- È la vista predefinita quando la funzione è accesa. Un interruttore "Raggruppa per categoria" (vicino al menu di ordinamento) permette di tornare alla griglia unica originale; la scelta si ricorda sul dispositivo.
- Nella vista raggruppata l'Armadio mostra **tutti** i capi che rispettano filtri e ricerca, senza paginazione (i gruppi non devono spezzarsi tra pagine). L'API oggi ha `page_size` massimo 100: il builder decide come caricarli tutti (più pagine in sequenza o un parametro/endpoint dedicato).
- L'ordinamento scelto nel menu vale dentro ogni gruppo. L'opzione "Per categoria" aggiunta oggi resta per la griglia unica.

## Vincoli del progetto (da `CLAUDE.md`)
- Fork di Wardrowbe: **moduli nuovi + agganci minimi** al codice originale.
- Dietro una variabile `.env` **spenta di default** (es. `WARDROBE_SECTIONS_ENABLED`), esposta in `/health/features`; `tests/conftest.py` la azzera per i test originali. Con la funzione spenta l'Armadio è esattamente come oggi.
- Ogni funzione nuova con test backend; test frontend con vitest; un test E2E Playwright sull'Armadio raggruppato e sulla finestra Organizza.
- Traduzioni nel namespace nuovo (it ed en scritte, le altre lingue copiano l'inglese).
- Migrazione Alembic nuova per le tabelle; niente modifiche a tabelle esistenti se evitabile.
- Telefono via browser: la finestra Organizza deve funzionare al tocco (le frecce sono l'alternativa garantita al trascinamento).

## Obiettivi · Non obiettivi · Da non fare
- **Obiettivi:** trovare subito un tipo di capo; ordine dell'armadio deciso dall'utente; raccolte libere; nessuna domanda sul sesso.
- **Non obiettivi (per ora):** raccolte annidate; categorie nuove definite da regole sui tipi (le raccolte sono solo manuali); usare le raccolte come filtro in Suggerisci (idea per dopo); condividere raccolte con la famiglia.
- **Da non fare:** cambiare la logica degli outfit; perdere capi (un capo deve sempre comparire in almeno un gruppo, anche solo "Da sistemare"); rompere la griglia originale con la funzione spenta.

## Lasciato al builder
- Schema delle tabelle (per esempio una tabella per i gruppi dell'utente con tipo, chiave della categoria o nome della raccolta, posizione, acceso/spento, e una tabella di collegamento raccolta–capo) e forma delle API.
- Dove vive la tabella tipo→categoria (backend, frontend o generata come il vocabolario) purché ci sia una sola fonte.
- Libreria per il trascinamento (es. `@dnd-kit/sortable`) o soluzione nativa, purché funzioni col tocco e da tastiera.
- Come caricare tutti i capi nella vista raggruppata.
