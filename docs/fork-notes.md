# Note sul fork: cosa c'è in Wardrowbe e dove agganciare l'MVP

Lettura del codice fatta il 2026-10-27 su `main` (Wardrowbe 1.12.0 + rilevamento marca e sfondo automatico).
Per ogni area: cosa esiste, cosa manca rispetto a CLAUDE.md, punto di aggancio con la modifica minima.

## 1. Modello dei capi

**Esiste** (`backend/app/models/item.py`, `ClothingItem`)
- Classificazione: `type`, `subtype`. Attributi sia come colonne sia nel JSONB `tags`, tenuti allineati
  (`TAG_COLUMNS`): `colors`, `primary_color`, `pattern`, `material`, `style`, `season`, `formality`; `fit` solo in `tags`.
- Metadati utente: `name`, `brand`, `notes`, `favorite`, prezzo, data acquisto.
- Uso: `wear_count`, `last_worn_at`, `suggestion_count`, `acceptance_count`; lavaggi (`needs_wash`, `wears_since_wash`).
- Immagini: `image_path`, `thumbnail_path`, `medium_path`, `original_image_path` (backup prima della rimozione sfondo),
  **`ItemImage`** per foto aggiuntive di un capo (ordinate per `position`).
- Doppioni: `image_hash` = pHash; al caricamento si confronta solo l'**uguaglianza esatta** (`item_service.py:174`).
- Idempotenza: `upload_key` univoco per utente, usato dalla coda di upload in blocco del frontend (IndexedDB).
- Stato AI: `status` (processing/ready/error/archived), `processing_kind`, `ai_confidence` (un solo numero), `ai_raw_response`.

**Vocabolario** (`backend/app/data/garment_vocabulary.json`, letto da `app/utils/garment_vocabulary.py`)
- Ogni tipo ha un **ruolo**: `base_top`, `mid_layer`, `outer_layer`, `bottom`, `full_body`, `suit`, `footwear`,
  `socks`, `legwear`, `neckwear`, `accessory`. Sono già gli slot della spec.
- Formalità: 6 livelli ordinati `very-casual … very-formal` (stringa, non numero).
- Occasioni con le formalità ammesse (`OCCASION_FORMALITY`), 15 materiali, 20 colori con alias.

**Manca rispetto alla spec**
- **Calore 1–5**: nessun campo. Oggi il calore è dedotto da tipo/materiale/stagione (`item_scorer._temp_bucket_score`).
- **Formalità 1–5**: la si ottiene mappando i 6 livelli per posizione; non serve una colonna nuova.
- **Categoria/sottocategoria**: `type`/`subtype` + ruolo coprono il bisogno.
- **Confidenza per campo**: c'è solo `ai_confidence` complessivo (completezza dei tag) e `logprobs_confidence`,
  che con Gemini non arriva mai (vedi §2).
- **Embedding**: niente pgvector, niente CLIP.

**Aggancio**
- Calore: colonna `warmth SMALLINT NULL` + chiave nel prompt di tagging, con migrazione alembic nuova. Il punteggio
  la usa se presente, altrimenti resta l'euristica attuale.
- Confidenza per campo: chiave `field_confidence` nel JSONB `tags` (nessuna migrazione).
- Embedding: tabella separata `item_embedding(item_id, model, vector)` in un modulo nuovo, invece di aggiungere una
  colonna a `clothing_items`: tocca meno il modello originale e permette di cambiare modello.

## 2. Worker arq e AI

**Esiste**
- Due code (`app/workers/queues.py`): `arq:tagging` (worker AI + cron) e `arq:images` (rotazione, rimozione sfondo, rembg).
- Concorrenza AI = `AI_TAGGING_CONCURRENCY` (default 1). I cron condividono lo stesso pool.
- Retry su due livelli: nel client (`AIService._call_with_fallback`, `AI_MAX_RETRIES`=3, attese 2–4 s) e nel job
  (`TAGGING_MAX_TRIES`=3, `Retry` con attesa 10→20 s). Su un errore che si ripete il job finisce in `error`, e il retry
  manuale è bloccato per `AI_RETRY_COOLDOWN_SECONDS`.
- Sweep dei capi rimasti in `processing` all'avvio e ogni 15 minuti.
- Il tagging fa **2 chiamate per capo** (tag JSON + descrizione).

**Problemi con il piano gratuito Gemini**
- **Nessuna gestione specifica dei 429**: non legge `Retry-After` e le attese sono brevi. Nel caso peggiore una sola
  chiamata diventa 3×3 = 9 richieste ravvicinate, che peggiorano il limite invece di rispettarlo.
- **Nessun limite di richieste al minuto** condiviso tra i job: la concorrenza 1 regola il parallelismo, non la frequenza.
- **`logprobs` rifiutato da Gemini**: ogni capo spreca una richiesta (400 → riprova senza). In totale 3 richieste
  per capo invece di 2.
- La descrizione è nella lingua dell'utente (`users.locale`, ora `it`): i capi taggati prima del cambio restano in inglese.

**Aggancio**
- Modulo nuovo `app/services/rate_limiter.py`: token bucket in Redis per endpoint/modello (RPM e RPD da `.env`),
  chiamato prima di ogni `client.post` in `_call_with_fallback` (una riga). Sul 429: attesa = `Retry-After` oppure
  la prossima finestra del bucket, senza consumare un tentativo.
- `logprobs`: impostazione `AI_LOGPROBS_ENABLED` (default true per non cambiare l'originale, false nel nostro `.env`).
- Pipeline batch: job nuovo `process_upload_photo` nel modulo `app/workers/batch.py`, registrato in `WorkerSettings`.
  Ordine: sfondo (coda images) → embedding (CPU, stessa coda images per la RAM) → tagging (coda tagging).

## 3. Suggerimenti, punteggio e pairing

**Esiste già quasi tutta la struttura a due stadi della spec** (`app/services/recommendation_service.py`)
1. `get_candidate_items`: capi pronti, non archiviati, puliti, con tipo noto, meno quelli esclusi.
2. `include_items` = **capi fissati**: vengono aggiunti ai candidati anche se esclusi altrove; se non esistono o non
   possono formare un outfit completo → `ValueError` con messaggio chiaro (`can_complete_outfit`,
   `deduplicate_by_body_slot` in `app/utils/clothing.py`).
3. `score_items` (`app/services/item_scorer.py`): prodotto di meteo × formalità (rispetto all'occasione) × stagione ×
   recenza × preferenze apprese × uso, più un bonus per le coppie che hanno funzionato. Diversità garantita per
   scarpe e pantaloni. **Taglia a 70 candidati** (`TOP_N`) e lo fa solo da 50 capi in su (`MIN_ITEMS_FOR_SCORING`).
4. LLM: prompt `prompts/recommendation.txt` con i candidati numerati; risposta JSON con **3 outfit** di numeri.
5. Validazione: numeri fuori lista scartati, fissati reinseriti se mancano, un solo capo per slot, leggings tolti se fa caldo.
   Se nessuna proposta è completa, il buco si riempie con il capo meglio classificato (`fill_missing_regions`).
   Le proposte avanzate vanno in una cache Redis per "Prova un altro".
- API: `POST /outfits/suggest` (1 outfit) e `/outfits/suggest-options` (3), entrambe con `include_items`,
  `exclude_items`, `occasion`, `weather_override`, `time_of_day`.
- Log indossati: `POST /outfits/{id}/wear-today`, `/wore-instead`, `/feedback`; `POST /items/{id}/wear`.
- Pairing (`pairing_service.py`): dato un capo, l'LLM propone outfit attorno a esso. È un caso particolare dei capi fissati.
- Frontend: la pagina `dashboard/suggest` permette di fissare **un solo** capo; lo Studio ne accetta molti ma
  serve per comporre outfit a mano.

**Manca rispetto alla spec**
- **Filtri utente** (colori, formalità, materiale, stagione, preferiti, "non indossato da N giorni"…): nessuno.
- **Formalità ±1 dai fissati**: oggi la formalità si confronta solo con l'occasione.
- **Armonia dei colori nel punteggio**: c'è solo nel prompt, il punteggio è per singolo capo, non per combinazione.
- **Top 15**: oggi l'LLM riceve fino a 70 capi. Con un armadio piccolo (<50) riceve tutto senza punteggio.
- **Retry dell'LLM su output non valido**: non c'è; si passa subito al riempimento automatico. Se il JSON non è
  leggibile la richiesta fallisce con 503 invece di ripiegare sulle 3 combinazioni col punteggio più alto.
- **Scambio di un singolo capo** in un outfit proposto.

**Aggancio (task 3 del piano)**
- Modulo nuovo `app/services/outfit_filters.py`: schema Pydantic `OutfitFilters` + funzione pura
  `apply_filters(candidates, filters, pinned)`. Va chiamata subito dopo `get_candidate_items`. Nel servizio cambiano
  2 righe, più un campo opzionale `filters` in `SuggestRequest`.
- Formalità ±1 dai fissati: dentro `apply_filters`, come filtro rigido (i fissati sono sempre esenti).
- Top 15 e punteggio di combinazione: modulo nuovo `app/services/combo_scorer.py` che costruisce combinazioni per
  slot dai migliori candidati, le valuta (armonia colori, coerenza formalità, recenza, rating) e passa all'LLM
  solo i capi delle 15 combinazioni migliori. Il ripiego "top 3 per punteggio" viene da qui.
- Validazione/retry: funzione nuova `validate_llm_outfits` (id tra i candidati, tutti i fissati presenti) e un solo
  retry; poi ripiego sulle combinazioni del `combo_scorer`. Si aggancia nel ramo multi-outfit di
  `generate_recommendations` senza togliere la logica esistente.

## 4. Infrastruttura

- Postgres è `postgres:15-alpine`, **senza pgvector**. Per gli embedding serve l'immagine `pgvector/pgvector:pg15`
  (stessa versione maggiore, il volume dati resta compatibile) e `CREATE EXTENSION vector` in una migrazione.
- rembg gira con onnxruntime CPU. Per CLIP conviene **un modello ONNX su onnxruntime** invece di open_clip+torch:
  niente torch nell'immagine (centinaia di MB) e meno RAM. Da misurare prima di decidere.
- RAM misurata: stack a riposo ~0,8 GB; con rembg caricato ~1,3 GB (VM OrbStack fino a 3,9 GB).
- Test backend: `docker compose exec backend python -m pytest tests/` (serve il database `wardrobe_test`, creato a mano).
  `ruff` non è nell'immagine: si lancia da un container usa e getta con `pip install ruff`.
