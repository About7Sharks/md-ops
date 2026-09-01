# MD Ops API

## QMD retrieval: inventory first

Start with a bounded exact-keyword BM25 inventory. It does not load an embedding or reranking model:

```bash
timeout 30s qmd search '"exact phrase or identifier"' -c COLLECTION -n 20 --json
```

Reserve hybrid/vector retrieval for narrower follow-ups, cap the result set, and keep a timeout because local model startup or availability can make it much slower:

```bash
timeout 60s qmd query 'narrow follow-up question' -c COLLECTION -n 5 --json
```

The API's `/api/retrieve` path intentionally uses keyword-only `qmd search` with an 8-second process timeout. Run `qmd embed` as separately scheduled maintenance; do not hide a long embedding run behind a 600-second interactive wait.
