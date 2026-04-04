# DT Drawing Checker

A web app for automatically checking architectural/engineering drawing PDFs against a Notion drawing schedule. It uses Claude AI to extract title block data from each page and validates it against project settings and Notion database records.

## What It Does

Upload one or more drawing PDFs. The app processes each page, extracts title block information using Claude's vision API, and validates:

- **Project Details** — project name, number, client name against configured settings
- **Drawing Data** — suffix number, drawing title, drawing number, revision against the Notion drawing schedule
- **Drawing Status** — issued-for code, status, status-by, status date, and author
- **Finishes** — reads the Notion finishes database for the project suffix and allows manual result overrides
- **Revision History** — checks revision history entries on the drawing

Results are shown per-page with pass/fail indicators. You can export a summary report.

## Tech Stack

- **Backend:** Node.js / Express (port 3001)
- **Frontend:** React / Vite (port 5174)
- **AI:** Anthropic Claude (`claude-sonnet-4-5`) — image-based title block extraction
- **Database:** Notion API — drawing schedule and finishes lookup
- **PDF processing:** `pdf-to-img`, `pdf-lib`, `sharp`

## Prerequisites

- Node.js 18+
- A Notion integration token with access to your drawing schedule and finishes databases
- An Anthropic API key

## Setup

### 1. Install dependencies

```bash
npm run install-all
```

### 2. Configure environment

Create `server/.env`:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key

NOTION_API_KEY=your_notion_integration_token
NOTION_PROJECTS_DB_ID=your_projects_database_id
NOTION_DRAWING_SCHEDULE_DB_ID=your_drawing_schedule_database_id
NOTION_FINISHES_DB_ID=your_finishes_database_id
```

### 3. Run in development

```bash
npm run dev
```

This starts both the Express server and the Vite dev server concurrently. Open `http://localhost:5174`.

## Notion Database Requirements

### Drawing Schedule DB

Expected properties:

| Property | Type |
|---|---|
| Drawing Number | Text (rich_text) |
| Item (drawing title) | Text (rich_text) |
| Suffix # | Formula (string) |
| Rev | Formula (string) |
| Person | Text (plain_text) |
| S4 Status (LOR) | Select |
| S4 Status Date (LOR) | Date |
| S5 Status (F&P) | Select |
| S5 Status Date (F&P) | Date |

### Finishes DB

Expected properties: `Spec Ref`, `CAD Ref`, `Finish Description`, `Sample Ref`, `APPROVED`, `RESULT`, and a `suffix` rollup property used to filter by project suffix.

## Settings

App settings are stored in `localStorage` under `dt-drawing-checker-settings` and `dt-drawing-checker-check-options`. Configure via the Settings panel in the UI:

- **Cross-Check Values** — project name, number, client name to validate against
- **Format Rules** — drawing number format, revision format
- **Required Fields** — toggle which fields are checked per section

## Project Structure

```
├── server/
│   ├── index.js          # Express API: upload, PDF processing, Notion queries
│   └── uploads/          # Temporary PDF storage (git-ignored)
├── client/
│   ├── src/
│   │   ├── App.jsx               # Main app component
│   │   ├── App.css               # All styles
│   │   ├── validationRules.js    # Validation logic (3 sections)
│   │   ├── settingsDefaults.js   # Settings schema and localStorage helpers
│   │   ├── Settings.jsx          # Settings UI
│   │   ├── ExportModal.jsx       # Export report modal
│   │   └── PdfViewer.jsx         # In-browser PDF viewer
│   ├── index.html
│   └── vite.config.js
├── package.json
└── .gitignore
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload a PDF file |
| `/api/check` | POST | Run checks on an uploaded PDF |
| `/api/notion-lookup` | POST | Query drawing schedule by suffix |
| `/api/finishes-lookup` | POST | Query finishes DB by suffix |
| `/uploads/:filename` | GET | Serve uploaded PDF files |

## Notes

- PDFs are converted page-by-page to images and sent to Claude for title block extraction
- If a drawing number extraction looks suspect (< 12 chars or < 3 dashes), it is automatically retried with a more targeted prompt
- Multiple PDFs can be uploaded and checked in parallel; completed pages can be reviewed while others are still processing
- The `server/uploads/` directory is git-ignored — files are temporary and not committed
