# Source data

## `tracker-export-2026-10-10.tsv`

This is the legacy tracker sheet, *REPORT ON FINANCIAL TRANSPARENCY COMPLIANCE, As at OCTOBER 10,
2026*, saved as tab-separated text. It is the Phase 2 migration fixture.

- **Provenance.** The team pasted the sheet's cells into chat on 17 October 2026, and they were
  saved here unchanged. The only change is that empty cells after the last indicator column were
  trimmed from each line. Quoted multi-line cells, stray spaces, `#REF!` serials and every
  original value are kept as they were.
- **What it is not.** It is not the original workbook. Hyperlink targets hidden behind display
  text, such as "Key Institutional Data | NOUN", cannot be recovered from it. If the `.xlsx` is
  available, add it here as well. The importer can use it to recover real link targets.
- **Status of the content.** Every TRUE/FALSE is an *unverified legacy claim*. The 10 October date
  is when the dataset was reported, not when each website was checked. Nothing in this file is a
  verified assessment, and none of it is published.

Run the validation preview with:

```bash
npm run import:preview -- data/source/tracker-export-2026-10-10.tsv
```

It writes `data/reports/tracker-export-2026-10-10.held-rows.csv`, which lists the 70 rows that
need a human decision.
