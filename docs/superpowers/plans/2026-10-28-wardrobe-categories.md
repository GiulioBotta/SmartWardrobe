# Armadio per categorie e raccolte — piano di lavoro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'Armadio si mostra diviso per categorie (standard, nascoste attivabili, raccolte dell'utente) in un ordine scelto dall'utente.

**Architecture:** una sola fonte JSON (`backend/app/data/wardrobe_sections.json`) definisce categorie, tipi e ripieghi; il generatore esistente ne produce la copia TypeScript. Il backend salva solo le scelte dell'utente (ordine, categorie accese, raccolte e i loro capi) in due tabelle nuove; il raggruppamento dei capi avviene nel frontend, sui capi già filtrati.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic; Next.js 14 + React Query + next-intl + Tailwind; `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2 per il trascinamento.

**Spec:** `docs/superpowers/specs/2026-10-28-wardrobe-categories-design.md` (bozze: `.superpowers/brainstorm/6235-1793187539/content/armadio-categorie.html`)

## Global Constraints

- Funzione dietro `WARDROBE_SECTIONS_ENABLED` (default `false`), esposta come `wardrobe_sections` in `/health/features`; con la funzione spenta l'Armadio è identico a oggi.
- Moduli nuovi + agganci minimi al codice originale; ogni aggancio porta un commento `Fork:`.
- `backend/tests/conftest.py` rimuove `WARDROBE_SECTIONS_ENABLED` dall'ambiente, come gli altri flag del fork.
- Nomi utente: "Raccolte" / "Raccolta" (mai "cartelle"). Categorie standard, in quest'ordine iniziale: Magliette e camicie · Felpe e maglioni · Giacche · Pantaloni · Scarpe e stivali · Accessori. Nascoste: Gonne · Vestiti · Completi · Borse · Calze e collant. Gruppo di servizio: Da sistemare.
- Le categorie non toccano la logica degli outfit (`ITEM_ROLE`, scorer, prompt).
- Icone solo lucide-react (`Bookmark`, `GripVertical`, `ChevronDown`, `ArrowUp`, `ArrowDown`, `Pencil`, `Trash2`, `Plus`, `RotateCcw`, `SlidersHorizontal`), interruttore `components/ui/switch.tsx`, titoli `font-serif`, etichette `label-caps`, colore `--brand`. Nessuna emoji.
- Traduzioni nel namespace nuovo `wardrobeSections` (it ed en scritte, le altre 6 lingue copiano l'inglese), registrato in `frontend/lib/i18n/locales.ts`.
- Test: backend `docker compose exec -T backend python -m pytest tests/ -q`; frontend con il comando `docker run … npx vitest run` di `CLAUDE.md`; ruff come da `CLAUDE.md`.
- Commit: nessun commit per task. Alla fine un solo commit su branch temporaneo, solo se l'utente lo chiede (convenzione di `CLAUDE.md`).

## Review Focus

- Capo con tipo `unknown` o non mappato → va in "Da sistemare", mai sparito (test in Task 1 e Task 4).
- Categoria nascosta spenta che contiene capi (es. una gonna) → il capo va nel ripiego (Pantaloni), e la finestra Organizza mostra "N capi" accanto all'interruttore (test in Task 4 e Task 6).
- Nome raccolta vuoto, solo spazi, > 50 caratteri o uguale a un'altra a parte maiuscole → 422 con messaggio chiaro, mostrato come toast (test in Task 3).
- Ricerca/filtri che svuotano tutti i gruppi → lo stato vuoto "nessun risultato" esistente, non una pagina bianca (test in Task 5).
- `localStorage` non disponibile (navigazione privata) → chiudere/aprire i gruppi funziona lo stesso in memoria (test in Task 5).

---

### Task 1: Fonte unica delle categorie

**Files:**
- Create: `backend/app/data/wardrobe_sections.json`
- Create: `backend/app/services/wardrobe_sections.py`
- Modify: `frontend/scripts/gen-shared-data.mjs` (nuovo output `lib/generated/wardrobe-sections.ts`)
- Test: `backend/tests/test_wardrobe_sections_vocab.py`

**Interfaces:**
- Produces (Python): `STANDARD_KEYS: tuple[str, ...]`, `HIDDEN_KEYS: tuple[str, ...]`, `UNSORTED_KEY = "unsorted"`, `section_for_type(item_type: str, enabled_hidden: set[str]) -> str`.
- Produces (TS, generato): `STANDARD_SECTION_KEYS`, `HIDDEN_SECTION_KEYS`, `SECTION_TYPES: Record<string, readonly string[]>`, `SECTION_FALLBACK: Record<string, string>`.

JSON (chiavi fisse, usate da tabelle e traduzioni):
```json
{
  "standard": [
    {"key": "tops", "types": ["shirt", "t-shirt", "top", "polo", "blouse", "tank-top"]},
    {"key": "knitwear", "types": ["sweater", "hoodie", "cardigan", "vest"]},
    {"key": "outerwear", "types": ["jacket", "coat", "blazer"]},
    {"key": "trousers", "types": ["pants", "jeans", "shorts"]},
    {"key": "footwear", "types": ["shoes", "sneakers", "boots", "sandals"]},
    {"key": "accessories", "types": ["hat", "scarf", "belt", "tie", "accessories"]}
  ],
  "hidden": [
    {"key": "skirts", "types": ["skirt"], "fallback": "trousers"},
    {"key": "dresses", "types": ["dress", "jumpsuit"], "fallback": "unsorted"},
    {"key": "suits", "types": ["suit"], "fallback": "outerwear"},
    {"key": "bags", "types": ["bag"], "fallback": "accessories"},
    {"key": "hosiery", "types": ["socks", "tights"], "fallback": "accessories"}
  ]
}
```

- [ ] **Step 1: Test** `test_every_vocabulary_type_has_exactly_one_section` (unione dei `types` == `TYPES`, nessun doppione); `test_hidden_type_falls_back_when_off` (`section_for_type("skirt", set()) == "trousers"`, `section_for_type("skirt", {"skirts"}) == "skirts"`, `section_for_type("dress", set()) == "unsorted"`); `test_unknown_type_is_unsorted` (`"unknown"` e `"culottes"` → `"unsorted"`); `test_standard_order` (`STANDARD_KEYS == ("tops", "knitwear", "outerwear", "trousers", "footwear", "accessories")`).
- [ ] **Step 2:** eseguire, deve fallire per modulo mancante.
- [ ] **Step 3:** scrivere JSON e `wardrobe_sections.py` (legge il JSON come `garment_vocabulary.py`).
- [ ] **Step 4:** aggiungere `renderWardrobeSections` al generatore ed eseguire `npm run vocab:gen` (dal container frontend, come in `CLAUDE.md`); `npm run vocab:gen -- --check` deve passare.
- [ ] **Step 5:** test verdi.

### Task 2: Tabelle, flag e migrazione

**Files:**
- Create: `backend/app/models/wardrobe_section.py`, `backend/migrations/versions/e7a1c3d5f9b2_add_wardrobe_sections.py` (`down_revision = "d2f4a6b8c0e1"`)
- Modify: `backend/app/models/__init__.py`, `backend/app/config.py` (`wardrobe_sections_enabled: bool = Field(default=False)` con commento Fork), `backend/app/api/health.py` (`"wardrobe_sections"`), `backend/tests/conftest.py`, `docker-compose.yml` (`WARDROBE_SECTIONS_ENABLED: ${WARDROBE_SECTIONS_ENABLED:-false}`), `.env.example`, `frontend/lib/hooks/use-features.ts` (`wardrobe_sections?: boolean`)
- Test: `backend/tests/test_wardrobe_sections_models.py`

**Interfaces:**
- Produces: `WardrobeSection` (`wardrobe_sections`: `id` UUID pk, `user_id` FK users CASCADE, `kind` `'category' | 'collection'`, `key` str|None, `name` str(50)|None, `position` int, `enabled` bool default true, `created_at`); vincoli unici `(user_id, key)` e indice unico su `(user_id, lower(name))` dove `kind='collection'`. `CollectionItem` (`collection_items`: `section_id` FK CASCADE, `item_id` FK `clothing_items` CASCADE, `added_at`; pk composta).

- [ ] **Step 1: Test** `test_deleting_an_item_removes_it_from_collections` e `test_deleting_a_collection_keeps_the_items`; `test_feature_flag_reported` (`/health/features` → `wardrobe_sections` false di default).
- [ ] **Step 2:** fallire.
- [ ] **Step 3:** modello, migrazione, agganci di config/health/compose/conftest/.env.example/use-features.
- [ ] **Step 4:** `alembic upgrade head` nel container, poi test verdi.

### Task 3: Servizio e API

**Files:**
- Create: `backend/app/schemas/wardrobe_section.py`, `backend/app/services/wardrobe_section_service.py`, `backend/app/api/wardrobe_sections.py`
- Modify: `backend/app/api/router.py` (una riga, commento Fork)
- Test: `backend/tests/test_wardrobe_sections_api.py`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces (tutte sotto `/api/v1/wardrobe-sections`, 404 se il flag è spento, solo dati dell'utente corrente):
  - `GET ""` → `{"sections": SectionOut[]}`; `SectionOut = {id, kind, key|null, name|null, position, enabled, item_ids: UUID[]}` (`item_ids` solo per le raccolte, solo capi non archiviati). Al primo accesso crea le righe di default (6 standard accese in ordine, 5 nascoste spente in coda).
  - `PUT "/order"` body `{"ids": UUID[]}` → nuovo ordine; deve contenere esattamente gli id dell'utente, altrimenti 422.
  - `PATCH "/{id}"` body `{"enabled"?: bool, "name"?: str}`: `enabled` solo per categorie nascoste (standard → 422); `name` solo per raccolte. Accendere una nascosta la sposta in fondo alle accese.
  - `POST "/reset-order"` → categorie nell'ordine iniziale, raccolte dopo, per `created_at`.
  - `POST "/collections"` body `{"name": str, "item_ids": UUID[]}` → `SectionOut` (in fondo all'ordine). `DELETE "/collections/{id}"`.
  - `POST "/collections/{id}/items"` e `POST "/collections/{id}/items/remove"` body `{"item_ids": UUID[]}`; id di capi altrui ignorati; doppioni ignorati.
  - `GET "/hidden-counts"` → `{"skirts": 0, …}`: quanti capi non archiviati finirebbero in ogni nascosta se fosse accesa.

- [ ] **Step 1: Test** (con `WARDROBE_SECTIONS_ENABLED` acceso via monkeypatch di settings): `test_defaults_created_once`, `test_reorder_requires_all_ids`, `test_standard_cannot_be_disabled`, `test_enable_hidden_moves_to_end`, `test_reset_order`, `test_collection_name_validation` (vuoto, spazi, 51 caratteri, "festa" vs "Festa" → 422), `test_collection_items_add_remove_idempotent`, `test_other_users_items_ignored`, `test_archived_items_hidden_but_kept` (archivia → sparisce da `item_ids`; ripristina → ritorna), `test_hidden_counts`, `test_disabled_flag_404`.
- [ ] **Step 2:** fallire.
- [ ] **Step 3:** schema, servizio, router.
- [ ] **Step 4:** test verdi + suite completa + ruff.

### Task 4: Dati e raggruppamento nel frontend

**Files:**
- Create: `frontend/lib/wardrobe-sections.ts`, `frontend/lib/hooks/use-wardrobe-sections.ts`
- Modify: `frontend/lib/i18n/locales.ts` (`'wardrobeSections'`), crea `frontend/messages/<locale>/wardrobeSections.json` per le 8 lingue
- Test: `frontend/tests/wardrobe-sections.test.ts`

**Interfaces:**
- Consumes: API del Task 3, generato del Task 1.
- Produces:
  - `sectionsApi` (get, reorder, patch, resetOrder, createCollection, deleteCollection, addItems, removeItems, hiddenCounts).
  - `type Section = {id, kind, key, name, position, enabled, item_ids}`; `type ItemGroup = {id: string; kind: 'category' | 'collection' | 'unsorted'; key: string | null; name: string | null; items: Item[]}`.
  - `groupItems(items: Item[], sections: Section[]): ItemGroup[]` — ordine = `position` delle sezioni accese; categorie riempite con `SECTION_TYPES` + ripieghi delle nascoste spente; raccolte con i capi di `items` il cui id è in `item_ids` (stesso oggetto `Item`, quindi la selezione per id vale in entrambi); "Da sistemare" (`id: 'unsorted'`) sempre ultimo; gruppi vuoti esclusi; dentro ogni gruppo i capi restano nell'ordine in cui arrivano (quindi vale l'ordinamento scelto nel menu).
  - Hook: `useWardrobeSectionsEnabled()`, `useWardrobeSections()`, `useHiddenCounts()`, mutazioni che invalidano `['wardrobe-sections']`; `useAllItems(filters: ItemFilter)` che legge tutte le pagine da 100 con gli stessi filtri e ordinamento di `useItems`.
  - Testi (`wardrobeSections.json`): nomi delle 11 categorie + "unsorted" sotto `names.<key>`; `organize.*`, `collection.*`, `groupToggle`, `itemCount` (plurale ICU), messaggi di errore.

- [ ] **Step 1: Test** `groupItems`: ordine per `position`; maglione e felpa con cappuccio in "knitwear"; gonna in "trousers" con skirts spenta e in "skirts" accesa; `unknown` in "unsorted" e "unsorted" ultimo; capo in una raccolta compare due volte con lo stesso oggetto; gruppi vuoti assenti; lista vuota → `[]`; l'ordine dei capi in ingresso si conserva dentro ogni gruppo.
- [ ] **Step 2:** fallire. **Step 3:** implementare. **Step 4:** verdi; `i18n-scan` e `i18n-dynamic-keys` verdi.

### Task 5: Armadio raggruppato

**Files:**
- Create: `frontend/components/wardrobe/grouped-wardrobe.tsx`
- Modify: `frontend/app/dashboard/wardrobe/page.tsx` (agganci: interruttore di vista + pulsante "Organizza" accanto al menu di ordinamento; se funzione accesa e vista raggruppata → `GroupedWardrobe` con `useAllItems`, paginazione nascosta; altrimenti codice attuale invariato)
- Test: `frontend/tests/grouped-wardrobe.test.tsx`

**Interfaces:**
- Consumes: `groupItems`, `ItemGroup`, hook del Task 4.
- Produces: `GroupedWardrobe({ groups, renderItem }: { groups: ItemGroup[]; renderItem: (item: Item, groupId: string) => ReactNode })`; chiave `localStorage` `wearly.wardrobe.collapsedGroups` (array di id, con try/catch); `wearly.wardrobe.grouped` (`'0'`/`'1'`, default raggruppato).

Titolo gruppo: `font-serif` + numero capi in `label-caps`, `ChevronDown` che ruota quando chiuso, `Bookmark` per le raccolte; pulsante con `aria-expanded`. Griglia uguale a quella attuale. La key React delle card è `${groupId}:${item.id}`.

- [ ] **Step 1: Test** titoli e conteggi resi nell'ordine dei gruppi; clic sul titolo chiude e riapre e scrive `localStorage`; con `localStorage.setItem` che lancia l'eccezione il clic funziona lo stesso; raccolta con icona `Bookmark` (via `data-kind="collection"`); `groups=[]` non rende niente (la pagina mostra lo stato vuoto esistente).
- [ ] **Step 2–4:** fallire, implementare, verdi. Prova nel browser: `/dashboard/wardrobe` con il flag acceso.

### Task 6: Finestra "Organizza"

**Files:**
- Create: `frontend/components/wardrobe/organize-sections-dialog.tsx`
- Modify: `frontend/package.json` (dipendenze `@dnd-kit/*` sopra, installate con `npm install` nel container e volume `smartwardrobe_frontend_node_modules`)
- Test: `frontend/tests/organize-sections-dialog.test.tsx`

**Interfaces:**
- Consumes: hook del Task 4.
- Produces: `OrganizeSectionsDialog({ open, onOpenChange, onNewCollection })`.

Contenuto come nella bozza 2: lista unica (categorie accese + raccolte) con `GripVertical` (dnd-kit, `PointerSensor` + `TouchSensor` + `KeyboardSensor`) e pulsanti `ArrowUp`/`ArrowDown`; raccolte con `Pencil` (rinomina in linea) e `Trash2` (conferma con `AlertDialog`); sezione "Altre categorie pronte" con `Switch` e "N capi" da `useHiddenCounts`; pulsanti "Nuova raccolta" (`Plus`, chiama `onNewCollection`) e "Ripristina ordine" (`RotateCcw`). Ogni spostamento chiama subito `reorder` (aggiornamento ottimistico, rollback e toast su errore).

- [ ] **Step 1: Test** freccia giù sul primo elemento → `reorder` chiamato con i primi due scambiati; freccia su disabilitata sul primo e giù sull'ultimo; interruttore Gonne → `patch(id, {enabled: true})`; "2 capi" accanto a Gonne quando `hiddenCounts.skirts = 2`; rinomina con nome già usato → toast d'errore e nome ripristinato.
- [ ] **Step 2–4:** fallire, implementare, verdi.

### Task 7: Creare e riempire le raccolte

**Files:**
- Create: `frontend/components/wardrobe/new-collection-dialog.tsx`, `frontend/components/wardrobe/collection-actions.tsx`, `frontend/components/wardrobe/item-collections-row.tsx`
- Modify: `frontend/components/bulk-action-toolbar.tsx` (prop opzionale `extraActions?: ReactNode` resa prima del pulsante Elimina, commento Fork), `frontend/app/dashboard/wardrobe/page.tsx` (passa `extraActions` e apre i dialoghi), `frontend/components/item-detail-dialog.tsx` (riga `ItemCollectionsRow` nella vista dettagli, solo con funzione accesa)
- Test: `frontend/tests/collections.test.tsx`

**Interfaces:**
- Consumes: Task 4, `OrganizeSectionsDialog.onNewCollection`.
- Produces: `NewCollectionDialog({ open, onOpenChange, initialItemIds })` — nome + galleria di tutti i capi (`useAllItems({})`) da toccare, pulsante "Crea con N capi" (disabilitato senza nome); `CollectionActions({ selectedIds })` — "Nuova raccolta", menu "Aggiungi a…" e "Togli da…" (`DropdownMenu`, elenco raccolte); `ItemCollectionsRow({ itemId })` — nomi delle raccolte del capo come badge, menu per aggiungere/togliere.

Con selezione "tutti i risultati" (`selection.mode === 'all'`) le azioni sulle raccolte usano gli id dei capi caricati in vista raggruppata meno gli esclusi.

- [ ] **Step 1: Test** creazione dalla selezione: dialogo aperto con i capi selezionati già spuntati e conteggio "Crea con 3 capi"; un capo selezionato che compare due volte conta una volta; "Aggiungi a…" chiama `addItems(collectionId, ids)`; la riga nella scheda mostra le raccolte del capo e "Togli" chiama `removeItems`; errore di nome dal server → toast, dialogo resta aperto.
- [ ] **Step 2–4:** fallire, implementare, verdi.

### Task 8: Prova finale e chiusura

**Files:**
- Create: `e2e/tests/wardrobe-sections.spec.ts`
- Modify: `.env` dell'utente (`WARDROBE_SECTIONS_ENABLED=true`), `CLAUDE.md` (stato e flag), `docs/fork-notes.md` non serve

- [ ] **Step 1:** E2E sull'armadio vero dell'account dev (sola lettura per i capi; le chiamate a `/wardrobe-sections` che modificano sono intercettate come in `inbox.spec.ts`): i titoli delle categorie compaiono nell'ordine; chiusura di un gruppo; apertura di Organizza, freccia giù, interruttore Gonne.
- [ ] **Step 2:** suite completa backend + frontend + ruff + `vocab:gen --check` + E2E.
- [ ] **Step 3:** prova manuale con Claude in Chrome a larghezza telefono (375 px): titoli leggibili, Organizza utilizzabile al tocco, nessuna emoji.
- [ ] **Step 4:** aggiornare `CLAUDE.md` (stato, flag, limiti noti). Commit solo su richiesta dell'utente.
