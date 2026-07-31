# Project Rules & Workspace Context: Odoo Reconciler

## Project Overview
- **Repository / Corpus**: `leoivardomondi/odooreconciler`
- **Application**: Odoo Job Summary PDF Extractor & Financial Reconciler
- **Stack**: Node.js (>= 20.20), TypeScript (`tsc` / `tsx`), Express.js, EJS, SQLite / MySQL, PDF Extraction & OCR (`pdf-parse`, `tesseract.js`, `@google-cloud/vision`), Odoo 19 integration.

## Key Entry Points & Structure
- **Main Server**: [server.ts](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/server.ts)
- **App Configuration**: [app.ts](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/app.ts)
- **Services & Logic**: [src/services/](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/src/services/)
  - E.g. [schedulerFailureAnalysisService.ts](file:///c:/xampp/htdocs/reconciler.flowcode.co.ke/src/services/schedulerFailureAnalysisService.ts)

## Workflow & Development Rules
- **Type Checking**: Run `npm run check` (`tsc --noEmit -p tsconfig.json`) to verify type safety.
- **Dev Server**: Run `npm run dev` (`tsx watch server.ts`) when testing backend services locally.
- **Context Persistence**: Store critical project decisions, database schema updates, and key business logic in this file (`.agents/AGENTS.md`) so future agent chats in this workspace retain full context.
