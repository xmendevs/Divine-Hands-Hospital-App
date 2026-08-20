# Fix History Log

This document records every **approved** fix applied to the Divine Hands Hospital
application. It exists so that:

1. All functionality of the software is verified working as it should.
2. A complete history of fixes is kept for future reference.

Each entry is added **only after the user approves** the fix.

---

## How to read this log

| Field       | Meaning                                            |
| ----------- | -------------------------------------------------- |
| `#`         | Sequential fix number                              |
| Date        | When the fix was approved and applied              |
| Area        | Which module / page / service the fix touched      |
| Issue       | What was wrong or not working as expected          |
| Fix         | What was changed to resolve the issue              |
| Files       | Source files that were modified                    |
| Verified    | How the fix was verified (tests, build, manual)    |
| Status      | `Applied` (done) or `In progress` / `Pending`      |

---

<!--
Template for new entries:

## Fix #N — <short title>

- **Date:** YYYY-MM-DD
- **Area:** <module / page / service>
- **Issue:** <what was broken or missing>
- **Fix:** <what was changed>
- **Files:** <paths to modified files>
- **Verified:** <typecheck / tests / build / manual test steps>
- **Status:** Applied

---

-->

## Fix #1 — Roster generator tab crashes the whole app (null departments)

- **Date:** 2026-08-17
- **Area:** Roster & Shifts page (desktop UI) + Go API store layer
- **Issue:** Opening the Roster page's **Monthly Generator** tab white-screened the
  entire app with `TypeError: Cannot read properties of null (reading 'map')`.
  `GET /api/v1/admin/departments` returned JSON `null` instead of `[]` when the
  departments table was empty, and the page called `departments.map(...)` on it.
  Root cause: `Store.ListDepartments` declared `var out []domain.Department`, a
  Go *nil* slice that serializes as `null`.
- **Fix:**
  - Backend: initialized the collector as `out := make([]domain.Department, 0)`
    so empty results serialize as `[]`. Also converted every other nil-slice
    collector in the store layer (`var out []T` → `make([]T, 0)`, 67 sites
    across all modules) so no other list endpoint can ever return `null`.
  - Frontend: added `?? []` guard when storing the departments response in
    `RosterPage` so a `null` response can never crash the page.
- **Files:**
  - `apps/go-api/internal/store/*.go` (67 collector conversions)
  - `apps/desktop/src/pages/RosterPage.tsx`
- **Verified:** Reproduced the crash in the live browser before the fix; after the
  fix the generator tab renders the department select. Full 13-page e2e sweep shows
  zero console errors. `go build`, `go vet`, `go test ./...`, desktop `tsc` and
  `vitest` (3/3) all pass.
- **Status:** Applied

---

## Fix #2 — Backup settings never load (`/admin/settings` returns null)

- **Date:** 2026-08-17
- **Area:** Settings page (backup section) + Go API store layer
- **Issue:** The backup settings form in Settings never populated because
  `GET /api/v1/admin/settings` returned JSON `null` instead of `[]`. The page
  called `settings.find(...)` on the response; it only survived because the
  fetch is wrapped in a try/catch, so the form silently stayed empty. Same
  nil-slice root cause as Fix #1 (`Store.ListSettings` used `var out []domain.Setting`).
- **Fix:**
  - Backend: converted `ListSettings` to `out := make([]domain.Setting, 0)`
    (covered by the systematic store-layer conversion in Fix #1).
  - Frontend: coalesced the response with `?? []` in `SettingsPage` so a `null`
    response can never crash or silently break the form.
- **Files:**
  - `apps/go-api/internal/store/audit.go`
  - `apps/desktop/src/pages/SettingsPage.tsx`
- **Verified:** Settings page loads cleanly in the live browser e2e sweep (zero
  console errors); desktop `tsc` and `vitest` pass; `go build` / `go test` pass.
- **Status:** Applied

---

## Fix #3 — Full patient intake, directory listing, and richer search

- **Date:** 2026-08-17
- **Area:** Patients Directory page (desktop UI) + Go API patients module
- **Issue:** The Patients Directory only returned results after typing a search
  query; the registration form captured only 6 basic fields; search matched
  name/phone/ID but not email or the full combined name; and next-of-kin
  records had no address field.
- **Fix:**
  - Backend: added `GET /api/v1/patients` to list all patients (newest first);
    extended `SearchPatients` to match full name, email, alternate phone;
    added a `next_of_kin_address` column (migration 0028); register flow now
    accepts clinical-history sections (allergies, medical/surgical history,
    chronic conditions, medications, family/social history) stored in
    `patient_clinical_entries` in the same transaction.
  - Frontend: directory loads all patients on open; registration modal rebuilt
    as a full intake form (personal, contact & address, identification,
    clinical history, next of kin incl. address, consent & privacy); patient
    record view shows the complete profile.
- **Files:**
  - `db/migrations/0028_patient_intake.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go`, `internal/store/patients.go`,
    `internal/httpapi/patients.go`, `internal/httpapi/router.go`, `README.md`
  - `apps/desktop/src/pages/PatientsPage.tsx`
- **Verified:** Live browser e2e — full UI registration (toast + directory
  refresh + clinical entries saved), list-all endpoint, email search, PATCH
  update all confirmed via API; `go build/vet/test`, `tsc`, `vitest`, `vite
  build`, `eslint` (0 errors) pass; migration 0028 applied to live DB (v28).
- **Status:** Applied

---

## Fix #4 — Current complaint tab, patient report page, edit form, send to doctor

- **Date:** 2026-08-17
- **Area:** Patients record view (desktop UI) + Go API patients/clinical module
- **Issue:** The patient record had no dedicated current-complaint view, no way
  to attach reports/notes with extra information, no edit form for existing
  patients, and no way to forward patient details to a doctor.
- **Fix:**
  - Backend: added `chief_complaint` as a valid clinical section (domain +
    validation + migration 0029 extending the `patient_clinical_entries` CHECK
    constraint); `PATCH /patients/{id}` now also replaces clinical-history
    sections via new `Store.ReplaceClinicalSection`; reports were already
    supported via `POST/GET /patients/{id}/reports`.
  - Frontend: record view is now tabbed — **Overview**, **Current Complaint**,
    **Clinical History**, **Reports & Notes** (add report/note form + list),
    **Documents**, **Timeline**; added an **Edit Patient** form (pre-filled,
    PATCH save, clinical sections editable) and a **Send to Doctor** button
    (confirm dialog → creates a task in the doctor's queue with the patient's
    details). Added a `send` icon to the `@hims/ui` kit.
- **Files:**
  - `db/migrations/0029_chief_complaint.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go`, `internal/httpapi/patients.go`,
    `internal/store/patients.go`
  - `apps/desktop/src/pages/PatientsPage.tsx`, `packages/ui/src/Icon.tsx`
- **Verified:** Live browser e2e — record tabs render; current complaint shows
  real data; report added via UI (toast + list refresh); edit form saves and
  reflects in the record; Send to Doctor creates a real task (confirmed in DB
  and via GET /tasks); `go build/vet/test`, `tsc`, `vitest`, `vite build` all
  pass; migration 0029 applied to live DB (v29).
- **Status:** Applied

---

## Fix #5 — Patient photo (snap/upload) + directory shows all patients

- **Date:** 2026-08-17
- **Area:** Patients page (desktop UI) + Go API patients module
- **Issue:** There was no way to attach a patient photo during registration or
  editing, and the patient record had no visual identifier. (The directory
  already listed all registered patients without typing — verified and kept.)
- **Fix:**
  - Backend: migration 0030 adds `photo_data` (base64) and
    `photo_content_type` columns to `patients`; register and PATCH update both
    persist the photo; the patient response returns it (set / clear / re-set
    all supported).
  - Frontend: a reusable `PhotoPicker` component in the Register and Edit
    forms — **Upload Image**, **Take Photo** (camera), live preview, Remove,
    and automatic downscaling to ≤600px on a canvas to keep payloads small;
    the photo renders as a circular avatar in the patient record's Overview.
- **Files:**
  - `db/migrations/0030_patient_photo.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go`, `internal/store/patients.go`,
    `internal/httpapi/patients.go`
  - `apps/desktop/src/pages/PatientsPage.tsx`
- **Verified:** Live browser e2e — photo picker present in both forms (upload,
  snap, file input, preview); API round-trip verified (register with photo,
  fetch back, clear, re-set); directory lists all patients on open (3 rows,
  no search); 13-page sweep zero console errors; `go build/vet/test`, `tsc`,
  `vitest`, `vite build` all pass; migration 0030 applied to live DB (v30).
- **Status:** Applied

---

## Fix #6 — Clinical module upgrade: doctor workload, expanded vitals, granular order types, audit trail

- **Date:** 2026-08-17
- **Area:** Orders & Clinical page (desktop UI) + Go API clinical/orders/reports module
- **Issue:** The clinical module lacked role-specific doctor workload metrics,
  structured vitals (only BP, temperature, pulse were captured), granular order
  categories (queue only had prescription/lab_request/nursing_order/referral),
  and human-readable author metadata on notes and orders for the audit trail.
- **Fix:**
  - Backend: expanded `DoctorReport` (patients seen today, pending critical
    labs, active orders by type, recent patient activity with pending labs /
    active orders per patient); BMI is now computed server-side on every vitals
    record from weight (kg) + height (cm); added order types
    `lab_investigation`, `radiology_imaging`, `nursing_procedure`,
    `dietary_ward` (domain + validation + migration 0031 extending the
    `orders.order_type` CHECK constraint); added `Store.NamesByUserIDs` and
    `authorName` / `orderedByName` on note and order responses for the audit
    trail. The audit log remains append-only (immutable records).
  - Frontend: ClinicalPage rebuilt with three tabs — **Doctor Workload**
    (assigned patients, patients seen today, pending results, critical labs,
    active orders by type, recent patient activity), **Consultation & Vitals**
    (respiratory rate, SpO₂, weight, height, auto-BMI, plus diagnosis/treatment
    plan linked to the vitals), and **Orders Queue** (all 8 order types with
    tailored fields — medication/dosage for prescriptions, test/specimen/
    priority for lab investigations, modality/region for imaging, procedure/
    frequency for nursing, diet type for dietary/ward). Notes and orders now
    display the authoring physician's name.
- **Files:**
  - `db/migrations/0031_order_types.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go`, `internal/store/reports.go`,
    `internal/store/users.go`, `internal/httpapi/clinical.go`,
    `internal/httpapi/orders.go`, `internal/httpapi/helpers.go`
  - `apps/desktop/src/pages/ClinicalPage.tsx`
- **Verified:** Live browser e2e — all three tabs render, 8 vitals fields incl.
  auto-BMI, all 8 order types in the select; API verified — doctor report
  returns the expanded shape, BMI computed (70kg/175cm → 22.9), all 4 new
  order types create and appear in the actionable queue with author names,
  notes return `authorName`; audit log confirmed append-only (mutation
  rejected); 13-page sweep zero console errors; `go build/vet/test`, `tsc`,
  `vitest`, `vite build`, `eslint` (0 errors) all pass; migration 0031  applied to live DB (v31). Test data cleaned up.
- **Status:** Applied

---

## Fix #7 — Clinical real-time sync, CDS alerts, history timeline, digital signatures

- **Date:** 2026-08-17
- **Area:** Orders & Clinical module (backend + desktop UI)
- **Issue:** No live linkage between doctor orders and the lab/pharmacy queues
  (order status only changed manually), no automated clinical-decision-support
  warnings for critical vitals or severe allergies when prescribing, no way to
  review a patient's past consultations / vitals trend / lab results without
  leaving the order screen, and no role-verified sign-off on consultations and
  orders for audit compliance. Superadmins also could not view the doctor
  workload report.
- **Fix:**
  - Real-time sync: migration 0032 adds `order_id` to `lab_requests` and
    `signed_by` / `signed_at` / `signature_hash` to `notes` and `orders`.
    Releasing a lab request now auto-completes the linked order (same
    behavior as pharmacy dispensing completing prescription orders). The
    Clinical Orders Queue renders a **LIVE QUEUE** with 5s auto-refresh and a
    last-sync timestamp.
  - CDS alerts: new `GET /patients/{id}/cds-alerts` endpoint flags critical
    vitals (BP ≥180/120, temp ≥39°C, SpO₂ ≤90%, pulse ≥120, RR ≥25) and
    severe patient allergies; warning banners render on the consultation and
    order tabs when a patient is selected.
  - History timeline: new `GET /patients/{id}/history` bundle endpoint
    (consultations/notes, vitals trend, lab results, orders, allergies); the
    Clinical page's **Patient History Timeline** button opens a drawer with
    Consultations / Vitals Trend / Lab Results tabs.
  - Digital signatures: notes and orders can be signed via
    `POST /notes/{id}/sign` and `POST /orders/{id}/sign` — the signer must
    re-enter their password (role-verified credentials), a cryptographic
    signature hash is stored, and the attestation is recorded in the audit
    log and the patient timeline. Superadmin can now access the doctor
    workload report (`GET /reports/doctor`).
  - Frontend: LabPage new-request form includes the doctor's order link.
- **Files:**
  - `db/migrations/0032_clinical_sync.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go`, `internal/store/lab.go`,
    `internal/store/clinical.go`, `internal/store/orders.go`,
    `internal/store/clinical_support.go` (new),
    `internal/httpapi/clinical_support.go` (new), `internal/httpapi/lab.go`,
    `internal/httpapi/clinical.go`, `internal/httpapi/orders.go`,
    `internal/httpapi/helpers.go`, `internal/httpapi/router.go`,
    `internal/httpapi/reports.go`
  - `apps/desktop/src/pages/ClinicalPage.tsx`, `apps/desktop/src/pages/LabPage.tsx`
- **Verified:** API round-trips — lab request linked to a doctor's order,
  walked the full lab chain (receive → processing → results → supervisor
  verify → release) and the linked order auto-completed with `completed_at`;
  CDS endpoint returned all 5 critical vitals alerts for the demo patient;
  history bundle returned notes/vitals/lab/orders/allergies; sign order with
  wrong password rejected (401) and correct password attested with a
  signature hash; `/reports/doctor` returns for superadmin. Browser e2e — all
  three Clinical tabs render, CDS warning banners show on patient select,
  history timeline drawer opens, Orders Queue shows live auto-refresh + all 8
  order types; 13-page sweep zero console errors; `go build/vet/test`, `tsc`,
  `vitest`, `vite build`, `eslint` (0 errors) all pass; migration 0032 applied
  to live DB (v32). Test data cleaned up.
- **Status:** Applied

---

## Fix #8 — Lab & Pathology upgrade: barcode accessioning, TAT dashboard, two-step verification, critical alert routing, analyzer integration, test catalogue + crash fix

- **Date:** 2026-08-18
- **Area:** Lab & Pathology module (backend + desktop UI)
- **Issue:** The lab module was missing specimen tracking (no barcode/chain of
  custody), no turnaround-time visibility, raw results were published without
  a separate verification step, critical results had no direct route to the
  attending physician, no integration hooks for analyzers, an almost-empty
  test catalogue (only Full Blood Count), no way to manually type a test not
  in the list, and — the crash — the app pointed at a stale packaged server on
  8080 that didn't batch-load test items, so the queue white-screened with
  `TypeError: Cannot read properties of undefined (reading 'map')` and lab
  requests could not be created. Specimen collection also used `window.prompt`,
  which silently returns null in the packaged app's WebView2 and aborted
  collection.
- **Fix:**
  - Barcode specimen accessioning (migration 0033): every specimen gets a
    unique machine-readable barcode (e.g. `BC00000022`) with a Luhn-style
    check character at collection; origin location (ward/OPD) recorded and
    shown in the chain-of-custody event; barcodes display in the work queue,
    result entry, and specimen views. The list endpoint now batch-loads items
    + specimens so the queue shows tests and barcodes without N+1 queries.
  - TAT monitoring dashboard: new `GET /lab/tat` computes pre-analytical
    (collection → lab receipt), analytical (receipt → result entered), and
    post-analytical (verified → released) phases with avg / p95 /
    within-target % and bottleneck flags against quality targets (30 / 120 /
    30 min). New **TAT Monitoring & Analyzers** tab renders phase cards + a
    per-request table.
  - Two-step verification: formal separation of raw result entry from
    Pathologist/Senior Technologist verification and sign-off (self-
    verification blocked); `resultEnteredByName` / `resultVerifiedByName` now
    surfaced in the entry table with a "Pending sign-off" state for
    unverified results.
  - Critical value alerting: entering a critical result routes a **direct
    comms message** to the attending physician's communications queue plus an
    in-app notification (`lab_critical` linking to /lab).
  - Instrument/analyzer integration ready (migration 0033): `lab_instruments`
    registry (chemistry/haematology/etc. with online/offline/maintenance
    status) and `lab_instrument_logs` append-only interface queue
    (inbound/outbound order/sample/result/query/ack messages with JSON
    payloads, queued → processed) — ready for HL7-style interfacing;
    instruments panel shows each analyzer's status + queued messages.
  - Test catalogue (migration 0034): seeded **69 tests** across haematology
    (14), chemistry (32), microbiology (10), immunology (7), and urinalysis
    (3) — e.g. FBC, Hb, WBC, Platelets, ESR, Blood Group & Genotype, FBS/RBS,
    HbA1c, LFT, RFT, Lipid Profile, TSH/FT4, Troponin, CRP, M/C/S, HIV, Hep
    B/C, PT/INR/APTT, GXM, etc.
  - Manual test typing: the new-request form has a "Type a test not in the
    list" field — typed names resolve case-insensitively against the
    catalogue (e.g. "Fasting Blood Sugar" → `FBS`) or are auto-registered as
    custom tests (`CT00003`) and added to the request; duplicates blocked;
    live search filter narrows the catalogue ("malaria" → 2 tests).
  - Crash fix: `LabPage.tsx` guards every `r.items` / `specimens` access
    (`(r.items || [])`) so the queue renders regardless of server version;
    the stale server on 8080 was stopped and replaced with the freshly built
    backend (same DB on port 55432) so the app gets all new endpoints with no
    reconfiguration; specimen collection's `window.prompt` replaced with an
    in-app origin-input dialog (WebView2-safe).
- **Files:**
  - `db/migrations/0033_lab_barcode_tat.up.sql` / `.down.sql`,
    `db/migrations/0034_lab_test_catalogue.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go`, `internal/store/lab.go`,
    `internal/store/lab_tat.go` (new), `internal/httpapi/lab.go`,
    `internal/httpapi/lab_tat.go` (new), `internal/httpapi/router.go`
  - `apps/desktop/src/pages/LabPage.tsx`
- **Verified:** API round-trips — barcode `BC00000022` generated with origin
  recorded; TAT report computes all three phases from real data; two-step
  verify by a separate account (entered by Super Admin, verified by Lab
  SupTAT) before release; critical result created the comms message + in-app
  notification routed to the physician; analyzer registered + outbound order
  message queued; 69-test catalogue served; custom-only request auto-
  registered `CT00003` and matched `FBS` by name. Browser e2e — manual test
  typing created request `LAB000015` (HTTP 201, zero console errors), the
  collect dialog collected specimen `SPC000003` / barcode `BC00000033` /
  origin "OPD Ward 2", TAT tab renders all phases, catalogue filter works
  live, and the exact white-screen repro now renders the full queue against
  the 8080 server. 13-page sweep zero console errors; `go build/vet/test`,
  `tsc`, `vitest` (3/3), `vite build`, `eslint` (0 errors) all pass;
  migrations 0033 + 0034 applied to live DB (v34); new backend live on 8080;
  test data cleaned up (catalogue stays seeded).
- **Status:** Applied

---

## Fix #9 -- Pharmacy Dispense module: enterprise-grade dispensing drawer, allergy/interaction checks, batch selection, status workflow, enhanced inventory

- **Date:** 2026-08-18
- **Area:** Pharmacy Dispense module (backend + desktop UI)
- **Issue:** The pharmacy dispensing queue used a bare inline quantity input and a
  single "Verify & Dispense" button with no patient safety checks, no batch
  selection by the pharmacist, no sign-off workflow, no drug interaction or
  allergy alerts, no patient counseling notes, and no dispensation status
  tracking. The inventory tab lacked search functionality and had no visual
  stock-status badges. Dispensation records had no workflow states.
- **Fix:**
  - Dispense Action Drawer: clicking a prescription in the queue opens a
    structured right-side drawer panel with:
    - Patient & Allergy Safety Banner (green/red based on patient allergy data;
      loads via new `GET /pharmacy/check-allergies` endpoint querying
      `patient_clinical_entries` section `allergy`)
    - Drug Interaction Alerts (built-in severity table of 17 known drug pairs
      e.g. warfarin+aspirin, omeprazole+clopidogrel, metformin+alcohol;
      loads via new `GET /pharmacy/check-interactions` endpoint)
    - Batch & Expiry Selection (FIFO-ordered batch list with radio buttons;
      shows batch number, stock on hand, total stock, selling price, expiry
      date, FIFO priority badge, expired/expiring-soon badges; defaults to
      first FIFO batch; loads via new `GET /pharmacy/medicines/{id}/batches/fifo`)
    - Stock Deduction & Quantity input with available-stock display
    - Patient Counseling Notes textarea
    - Mandatory safety check confirmations (allergy check + interaction review)
    - Dispense & Send for Verification button
  - Status Workflow: dispensations now have `dispense_status`
    (pending_verification -> ready_for_pickup -> dispensed); transitions via
    new `PATCH /pharmacy/dispensations/{id}/status` with pharmacist/matron/
    superadmin sign-off recorded (`sign_off_by`, `sign_off_at`); invalid
    transitions rejected with proper error
  - Enhanced Dispense endpoint (`POST /pharmacy/dispense/enhanced`): tracks
    `allergy_check_passed`, `interaction_check_passed`, `counseling_notes`,
    and initial `dispense_status` on the dispensation record
  - Enhanced Inventory Tab: searchable medicine table (filters by name, code,
    category); visual badges for Normal (green), Low Stock (red), Inactive
    (grey); batch detail view with per-batch expired/expiring-soon badges
  - Dispensation History Tab (new): shows all dispensations with status
    badges, sign-off info, dates; action buttons for pending verification
    and ready-for-pickup; full audit trail
  - KPI Cards: expanded to 5 -- Pending Dispense, Pending Verification,
    Low Stock Alerts, Medicines on File, Dispensed Total
  - Patient names on orders: `patientName` and `patientNo` added to the
    order response (used in clinical, pharmacy, lab modules)
  - Known drug interaction table: warfarin+aspirin, warfarin+ibuprofen,
    warfarin+paracetamol, metformin+alcohol, metformin+gliclazide,
    amlodipine+simvastatin, omeprazole+clopidogrel, ciprofloxacin+
    theophylline, ciprofloxacin+warfarin, enalapril+spironolactone,
    metoprolol+verapamil, lithium+ibuprofen, methotrexate+ibuprofen,
    fluoxetine+tramadol, sertraline+tramadol, amiodarone+simvastatin,
    fluconazole+warfarin
- **Files:**
  - `db/migrations/0035_pharmacy_dispense_upgrade.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go` (Dispensation struct extended)
  - `apps/go-api/internal/store/dispensing.go` (dispCols, scanDispensation,
    GetDispensation, ListDispensations, GetPatientAllergies,
    CheckDrugInteractions, knownInteraction, toLower, UpdateDispenseStatus,
    EnhancedDispense, ListBatchesWithFifo)
  - `apps/go-api/internal/httpapi/pharmacy.go` (handleCheckAllergies,
    handleCheckInteractions, handleUpdateDispenseStatus,
    handleListBatchesFifo, handleEnhancedDispense, dispensationResponse
    extended with status/signoff/counseling fields)
  - `apps/go-api/internal/httpapi/orders.go` (patientName/patientNo on
    orderResponse; patientDisplayNames in handleListActionableOrders)
  - `apps/go-api/internal/httpapi/helpers.go` (patientDisplayNames helper)
  - `apps/go-api/internal/httpapi/router.go` (5 new routes)
  - `apps/desktop/src/pages/PharmacyPage.tsx` (full rewrite: dispense
    drawer, enhanced inventory, history tab, KPIs, search, badges)
- **Verified:** Full API round-trip: allergy check returned "Penicillin --
  severe anaphylaxis" for the test patient; drug interaction check for
  warfarin returned 0 interactions (no current medications); FIFO batch
  listing returned batches ordered by expiry; enhanced dispense created
  DSP000001 with status=pending_verification, allergyCheckPassed=true,
  interactionCheckPassed=true, counselingNotes recorded; status transitions
  verified: pending_verification -> ready_for_pickup (sign-off recorded
  with UUID + timestamp) -> dispensed; invalid transition
  (dispensed -> ready_for_pickup) correctly rejected with 409; patient
  names on orders: ORD000010 showed Patient: Dolapo Ibe (DHH0001).
  `go build/vet/test` all pass; `tsc` passes; `vitest` 3/3 pass;
  `vite build` succeeds; `eslint` 0 errors; migration 0035 applied to
  live DB (v35); backend live on 8080; test data cleaned up.
- **Status:** Applied

---

## Fix #10 -- Hospital Inventory & Assets: 3-tab layout, lab consumables module, edit/delete with super admin validation, clinical order suggestions

- **Date:** 2026-08-18
- **Area:** Inventory & Assets page (desktop UI) + Clinical Orders module + Go API
- **Issue:** The Inventory page had minimal columns, no lab consumables module
  (the lab tab reused asset categories as a workaround), no edit/delete for
  wrong entries, no batch number or expiry date visible in the pharmacy main
  table, and the Clinical Orders form had no inventory-based suggestions --
  doctors had to type medication and test names from memory with no guidance
  on what was available in stock or the lab catalogue.
- **Fix:**
  - 3-Tab Inventory Layout:
    - Pharmacy Tab (Drug SKU): SKU/Code, Medication, Category, Strength/Form,
      **Batch Number & Expiry Date** (shows earliest active batch with
      expired/expiring badges and batch count), Reorder Level, Unit Cost
      (NGN), Selling Price (NGN), Stock Balance, Status (Optimal/Low Stock/
      Out of Stock), Edit/Delete (super admin only). Batch info pre-loaded
      for all medicines on page mount.
    - Laboratory Tab (Consumables): new `lab_consumables` table (migration
      0036) with Item Code, Consumable Name, Category, Packaging Unit,
      Batch/Lot Number, Reorder Level, Unit Cost (NGN), Stock Balance,
      Storage Location, Status (Available/Low Stock/Out of Stock),
      Edit/Delete (super admin only). Full CRUD: Create, List (with search),
      Get, Update, Delete.
    - Hospital Assets Tab: Asset Tag, Equipment Name, Category, Serial
      Number, Department/Location, Valuation (NGN), Status, Action buttons
      (Mark In Use / Mark Available / Mark Maintenance -- via in-app modal
      replacing window.prompt), Edit/Delete (super admin only).
  - Super Admin Validation: Edit and Delete buttons only render when the
    current user has `super_admin` role (checked via `useAuth()` hook).
    Non-superadmin users can view all data including prices but cannot
    modify.
  - Clinical Orders Suggestions: typing in the Prescription Medication
    field shows a dropdown of matching pharmacy inventory medicines (name,
    strength, form, category); typing in the Lab Investigation Test field
    shows a dropdown of matching lab catalogue tests (69 seeded tests with
    category and specimen type). Both filter in real-time and auto-fill
    the field on selection. The test suggestion also auto-fills the
    specimen type.
  - Backend: `DELETE /pharmacy/medicines/{id}` endpoint for soft delete
    (sets active=false); `ListMedicines` now filters `WHERE active` so
    deleted medicines are hidden; `DELETE /lab-consumables/{id}` already
    existed.
  - KPI Cards (6): Pharmacy Low Stock, Expiring/Expired, Lab Consumables,
    Lab Low Stock, Assets Under Service, Total Asset Value.
- **Files:**
  - `db/migrations/0036_lab_consumables.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go` (LabConsumable struct)
  - `apps/go-api/internal/store/lab_consumables.go` (new: CRUD for lab
    consumables)
  - `apps/go-api/internal/store/pharmacy.go` (DeleteMedicine, ListMedicines
    WHERE active)
  - `apps/go-api/internal/httpapi/lab_consumables.go` (new: HTTP handlers)
  - `apps/go-api/internal/httpapi/pharmacy.go` (handleDeleteMedicine)
  - `apps/go-api/internal/httpapi/router.go` (DELETE /pharmacy/medicines/{id},
    5 lab-consumables routes)
  - `apps/desktop/src/pages/InventoryPage.tsx` (full rewrite: 3 tabs,
    batch column, edit/delete modals, super admin check, KPIs, search)
  - `apps/desktop/src/pages/ClinicalPage.tsx` (pharmacy + lab test
    suggestions in order form)
- **Verified:** Pharmacy tab columns match spec exactly (SKU, name,
  category, strength/form, batch/expiry, reorder, unit cost, selling price,
  stock balance, status, edit/delete). Lab consumables CRUD verified
  end-to-end (create LAB-CON-001, list, update, delete). Edit/delete
  buttons only visible for super_admin role. Medication suggestion dropdown
  loads 4 pharmacy medicines; test suggestion dropdown loads 69 lab tests.
  `go build/vet/test` all pass; `tsc` passes; `vitest` 3/3 pass; `vite
  build` succeeds; `eslint` 0 errors; migration 0036 applied to live DB
  (v36); backend live on 8080; test data cleaned up.
- **Status:** Applied

---


## Fix #11 -- Billing & Cashier enterprise upgrade, role-based access control, order routing, test accounts

- **Date:** 2026-08-19
- **Area:** Billing & Cashier module, Role-Based Access Control, Clinical Orders routing, Sidebar quick-switcher, all pages
- **Issue:** The billing module was missing super admin validation/sign-off on charges and receipts, no installment payment tracking, no bill editing capability, no receipt sharing (WhatsApp/email/print), no role-based access (doctors could see the full financial dashboard), no "Charge Patient" workflow from lab/pharmacy/clinical pages, no "My Patients' Bills" view for doctors, no quick account switcher for testing, and the orders queue showed all order types to every role instead of filtering by department.
- **Fix:**
  - **Database (Migration 0037):** Added `validated_by`, `validated_at`, `validated_by_name` to invoices (super admin sign-off tracking); added `payment_plan`, `installment_amount`, `installment_frequency` for installment tracking; added `update_reason`, `updated_by` for audit trail on bill edits; added `payer_name`, `policy_number` for insurance/corporate billing.
  - **Database (Migration 0038):** Granted `billing.create` + `billing.view` to nurse, matron, pharmacist, lab_technician, lab_supervisor (so they can charge patients via ChargePatientModal); granted full pharmacy permissions (`medicines.view/manage`, `inventory.receive/dispense/adjust/transfer/count/approve`) to matron for inventory monitoring; granted `orders.view` to pharmacist, lab_technician, lab_supervisor so they can see the actionable orders queue.
  - **Backend:** Batch-loaded invoice line items in `ListInvoices` (fixes crash); added `POST /billing/invoices/{id}/validate` (super admin sign-off); added `PATCH /billing/invoices/{id}` (super admin bill edit with reason); added `GET /billing/patients/{id}/balance` (any authenticated user can check a patient's balance); added `GET /billing/my-patients-bills` (doctors see bills for their patients); role-based order filtering in `ListActionableOrdersForRole` -- prescriptions route to pharmacist, lab/radiology to lab staff, nursing/dietary to nurses/matron, super admin/doctor see everything; changed actionable orders endpoint permission from `orders.manage` to `orders.view` so pharmacist/lab roles can access it.
  - **Frontend -- BillingPage (5 tabs):** Dashboard (KPI cards, payment breakdown), Invoices (list with validation badge, detail panel, edit/validate/share actions), Payments & Receipts (full ledger), Cashier Shifts (open/close/reconcile), Validate & Sign-off (super admin only). Receipt sharing gated behind validation -- sharing disabled until super admin validates. Share modal with WhatsApp, Email, Copy Link, Download PDF, Print. Edit Invoice modal for super admin (discount, payment plan, installment details, audit reason).
  - **Frontend -- ChargePatientModal (new shared component):** Two modes -- Create Charge (search patient, select price list items, create invoice) and Check Balance (total charged, paid, balance due with invoice breakdown). Used across Clinical, Pharmacy, Lab, and Patients pages.
  - **Frontend -- Sidebar quick-switcher:** 7 test accounts (Doctor, Nurse, Matron, Pharmacist, Cashier, Lab Tech, Lab Supervisor) with color-coded role dots; one-click switch; "Return to SuperAdmin" gold button; Create Account and Manage Users for super admin.
  - **Frontend -- Role-based sidebar:** "Finance & Billing" nav group only visible to cashier and super_admin roles; all other roles (doctor, nurse, matron, pharmacist, lab tech, lab supervisor) do not see the billing sidebar.
  - **Frontend -- ClinicalPage:** "My Patients' Bills" tab showing invoices for patients the doctor has interacted with; Charge Patient button opens ChargePatientModal.
  - **Frontend -- PharmacyPage/LabPage:** "Charge Patient" button opens ChargePatientModal inline (no navigation to billing page).
  - **Frontend -- PatientsPage:** "Check Balance / Charge" button in patient detail modal.
  - **7 test accounts created:** doctor1/Doctor123!, nurse1/Nurse123!, matron1/Matron123!, pharmacist1/Pharm123!, cashier1/Cashier123!, labtech1/LabTech123!, labsupervisor1/LabSup123!.
- **Files:**
  - `db/migrations/0037_billing_validation.up.sql` / `.down.sql`
  - `db/migrations/0038_rbac_matron_pharmacy_billing.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go` (Invoice validation/installment fields)
  - `apps/go-api/internal/store/billing.go` (batch-load items, ValidateInvoice, UpdateInvoice, PatientBalance, DoctorsPatientsBills)
  - `apps/go-api/internal/store/orders.go` (ListActionableOrdersForRole)
  - `apps/go-api/internal/httpapi/billing.go` (validate, update, patient balance, doctor's bills handlers)
  - `apps/go-api/internal/httpapi/orders.go` (role-based actionable orders)
  - `apps/go-api/internal/httpapi/router.go` (6 new routes, permission change on actionable)
  - `apps/desktop/src/App.tsx` (conditional sidebar, switch user, return to admin)
  - `apps/desktop/src/ui/Sidebar.tsx` (quick switcher, create/delete users, matron + lab supervisor accounts)
  - `apps/desktop/src/components/ChargePatientModal.tsx` (new shared component)
  - `apps/desktop/src/pages/BillingPage.tsx` (complete rewrite: 5 tabs, validation gating, share modal, edit modal)
  - `apps/desktop/src/pages/ClinicalPage.tsx` (My Patients' Bills tab, charge modal, role-based order filtering)
  - `apps/desktop/src/pages/PharmacyPage.tsx` (charge modal, orders.view permission)
  - `apps/desktop/src/pages/LabPage.tsx` (charge modal, orders.view permission)
  - `apps/desktop/src/pages/PatientsPage.tsx` (Check Balance / Charge button)
- **Verified:** `go build` / `go vet` pass; `tsc` / `eslint` (0 errors) / `vite build` pass; migrations 0037 + 0038 applied to live DB (v38); API verified: invoice batch-load, validate, update, patient balance, doctor's bills, role-based order filtering (pharmacist sees only prescriptions, lab staff sees lab/radiology, nurse/matron sees nursing/prescriptions, super admin sees all); all 7 test accounts login successfully; role-based sidebar visibility confirmed (billing hidden for non-cashier/admin); receipt sharing gated behind validation; matron has pharmacy access; lab supervisor account created.
- **Status:** Applied

---

## Fix #12 -- Order flow fixes: permission grants, priority tracking, doctor charge confirmation

- **Date:** 2026-08-19
- **Area:** Orders & Clinical module, Pharmacy, Lab, Billing
- **Issue:** The prescription flow was broken -- pharmacist could not process prescriptions because they only had `orders.view` but needed `orders.manage` to transition orders. Same issue for lab technician and lab supervisor. Order types had no priority/urgency tracking, and the frontend was not sending priority as a top-level field.
- **Fix:**
  - **Database (Migration 0039):** Granted `orders.manage` to pharmacist, lab_technician, and lab_supervisor roles so they can transition orders through their workflow stages. Added `priority` column to orders table (routine/urgent/stat) for urgency tracking across all order types. Added `invoice_id` column to orders for future auto-billing integration.
  - **Backend:** Updated Order domain struct to include Priority and InvoiceID fields; updated orderCols and scanOrder to include the new columns; updated CreateOrder to accept and persist priority; updated orderResponse to include priority and invoiceId.
  - **Frontend:** Updated ClinicalPage Order interface with priority field; added priority selector to order creation form; added priority column to orders queue table with color-coded badges (green=routine, orange=urgent, red=stat); updated PharmacyPage Order interface with priority; added priority column to pharmacy dispensing queue; updated order creation to send priority as top-level field.
  - **Permission fix verification:** Pharmacist can now transition prescription orders (tested: created order ORD000016 with priority=urgent, pharmacist transitioned to accepted successfully). Lab technician can now transition lab orders (tested: ORD000013 transitioned to accepted successfully).
- **Files:**
  - `db/migrations/0039_order_flow_fixes.up.sql` / `.down.sql`
  - `apps/go-api/internal/domain/domain.go` (Order struct: Priority, InvoiceID)
  - `apps/go-api/internal/store/orders.go` (orderCols, scanOrder, CreateOrderParams, CreateOrder)
  - `apps/go-api/internal/httpapi/orders.go` (orderResponse, newOrderResponse, createOrderRequest, handleCreateOrder)
  - `apps/desktop/src/pages/ClinicalPage.tsx` (Order interface, priority column, priority selector, order creation)
  - `apps/desktop/src/pages/PharmacyPage.tsx` (Order interface, priority column in queue)
- **Verified:** `go build` / `go vet` pass; `tsc` / `vite build` pass; migration 0039 applied to live DB (v39); pharmacist can transition prescription orders (ORD000016: submitted -> accepted); lab tech can transition lab orders (ORD000013: submitted -> accepted); priority field populated and returned in order responses.
- **Status:** Applied

---

## Fix #14 -- Payment fix, auto-invoice from orders, charge confirmation modal

- **Date:** 2026-08-19
- **Area:** Billing & Cashier, Orders & Clinical, Database
- **Issue:** The cashier could not receive payments -- every attempt returned HTTP 500. Root cause: the `payments` table was missing the `payer_name` column, which the Go code expected during INSERT. Additionally, there was no way to auto-create invoices from doctor orders (prescriptions, lab tests, radiology), and the doctor had no charge confirmation step before billing.
- **Fix:**
  - **Critical bug fix:** Added missing `payer_name` TEXT column to the `payments` table. Payment flow now works end-to-end: cashier can receive payments, receipts are generated, invoice status updates to paid/partially_paid.
  - **Auto-invoice (backend):** New store method `CreateInvoiceFromOrder` and endpoint `POST /billing/auto-invoice/order/{id}`. Automatically matches order details (medication name, test name, modality) against the active price list, creates an invoice with correct line items and prices, and links it to the order via `invoice_id`. Prevents duplicate invoicing. Works for prescriptions, lab investigations, lab requests, and radiology/imaging.
  - **Charge confirmation modal (frontend):** New `ChargeConfirmationModal` component shown after a doctor creates a billable order. Displays patient info, order type, matched price list items with quantities. Doctor can adjust quantities, remove items, see subtotal/tax/total, then confirm to create the invoice.
  - **Priority tracking:** All 8 order types now support priority (routine/urgent/stat). Color-coded badges on ClinicalPage and PharmacyPage order queues. Priority field sent to backend when creating orders.
- **Files:**
  - Database: added `payer_name` column to `payments` table
  - `apps/go-api/internal/store/billing.go` (new: CreateInvoiceFromOrder)
  - `apps/go-api/internal/store/orders.go` (priority in orderCols, scanOrder, CreateOrder)
  - `apps/go-api/internal/httpapi/billing.go` (new: handleAutoInvoiceFromOrder)
  - `apps/go-api/internal/httpapi/orders.go` (priority in orderResponse, createOrderRequest)
  - `apps/go-api/internal/httpapi/router.go` (new route: auto-invoice/order/{id})
  - `apps/go-api/internal/domain/domain.go` (Order: Priority, InvoiceID fields)
  - `apps/desktop/src/components/ChargeConfirmationModal.tsx` (new)
  - `apps/desktop/src/pages/ClinicalPage.tsx` (priority column, charge confirmation flow, priority selector)
  - `apps/desktop/src/pages/PharmacyPage.tsx` (priority column in dispensing queue)
- **Verified:** `go build` / `go vet` pass; `tsc` / `vite build` pass; payment confirmed working (INV000008: 5,000 paid in full, receipt RCP000006 generated); auto-invoice confirmed working (lab investigation -> INV000007: 5,000 for Full Blood Count); pharmacist can transition prescription orders; lab tech can transition lab orders; all 7 test accounts login successfully.
- **Status:** Applied

---

## Fix #15 - Staff Directory: Create, Delete, Edit Role + Role Display Fix

**Date:** 2026-08-19
**Summary:** Enterprise staff directory management with create, delete, edit role features, and fix for role display not updating after edit.

### Features Added

**1. Create New Staff (Super Admin only):**
- "+ Create New Staff" button in Staff Directory header
- Full form: First Name, Last Name, Username, Email, Employee Number (auto-generated), Password, Role (Super Admin, Doctor, Nurse, Matron, Pharmacist, Lab Technician, Lab Supervisor, Cashier, Receptionist), Department, Job Title
- Hire Date (required, date picker)
- Salary amount (Naira) and Salary Type (Per Hour, Weekly, Monthly)
- CV Upload (accepts .pdf, .doc, .docx)
- Optional contact fields (expandable): Contact Number 2, 3, 4, WhatsApp Number
- Auto-generated Employee Number (EMP00001, EMP00002, etc.)
- Account created with mustChangePassword: true
- Approval notification modal after creation

**2. Delete Staff (Super Admin only):**
- "Delete" button on each staff row (super admin only)
- Confirmation modal with warning
- Suspends user account and revokes all active sessions
- First super admin (superadmin) is protected from deletion

**3. Edit Role (Super Admin only):**
- "Edit" button beside each staff member's role in the table
- Modal showing current role with dropdown to select new role
- Permissions updated immediately via PUT /admin/users/{id}/roles
- Optimistic UI update -- role displays instantly in the table
- First super admin is protected from role changes
- Approval notification modal after role change

**4. Role Display Fix:**
- Root cause: Backend /staff list endpoint was not fetching roles from RBAC system
- Fix: Updated handleListStaff to call GetUserRoles() for each staff member
- Role column now shows the correct RBAC role, not stale jobTitle

**5. Additional Enhancements:**
- Email and Phone columns added to staff table
- Audit Log tab (super admin only) showing all system actions
- Search includes phone number
- Role display uses actual assigned role from RBAC system

### Files Modified
- `apps/desktop/src/pages/StaffPage.tsx` - Complete rewrite with create, delete, edit role, audit log
- `apps/go-api/internal/httpapi/staff.go` - Fixed handleListStaff to populate roles from RBAC

### Verified
- `tsc` / `vite build` -- both pass clean
- Backend /staff endpoint returns roles for all staff members
- finn Land role updated from doctor to nurse -- displays correctly
- All 8 test accounts login successfully
- First super admin protected from delete/edit
- Auto-generated employee number works
- CV upload accepts PDF/DOC/DOCX files

### Test Accounts
| Role | Username | Password |
|------|----------|----------|
| SuperAdmin | superadmin | 61922939070a1707696c |
| Doctor | doctor1 | Doctor123! |
| Nurse | nurse1 | Nurse123! |
| Matron | matron1 | Matron123! |
| Pharmacist | pharmacist1 | Pharm123! |
| Cashier | cashier1 | Cashier123! |
| Lab Tech | labtech1 | LabTech123! |
| Lab Supervisor | labsupervisor1 | LabSup123! |
- **Status:** Applied

---

## Fix #16 — Communications module: voice note duration fix, DM role badges, Google Meet-style broadcast room, real-time notification center

- **Date:** 2026-08-20
- **Area:** Staff Communications module (Direct Messages, Broadcasts, Notifications) + AppShell
- **Issue:** Three interconnected problems: (1) Voice notes sent via the recorder always showed "0 seconds" because `VoiceRecorder`'s `onstop` callback captured a stale React state closure for the elapsed duration, and `VoiceNotePlayer` had no fallback when `HTMLAudioElement.loadedmetadata` failed on base64 data URLs. (2) The DM staff directory listed names without any role visibility — no way to see at a glance who is a Doctor, Nurse, Pharmacist, etc. — and the "Filter staff" input was a dead component with no `onChange` handler. (3) The Live Broadcast room was a minimal modal with no participant grid, no reactions, no in-call chat, no file sharing, no host/viewer role separation, and used hardcoded fake participant data instead of real staff. (4) There was no global notification system — staff had no bell icon, no unread badge, no way to be alerted about incoming DMs, broadcasts, or calls.
- **Fix:**
  - **Voice note duration (VoiceRecorder.tsx):** Added `durationRef` (a `useRef<number>`) that increments every second alongside the React state timer. The `recorder.onstop` callback now reads `durationRef.current` instead of the stale `duration` state closure, so the correct elapsed seconds (e.g. 14, 65) are always passed to `onRecord(blob, elapsed)`. Added proper `AudioContext` cleanup on stop.
  - **Voice note playback (VoiceNotePlayer.tsx):** New `storedDuration` prop is displayed immediately as the duration label so the user sees the real length even before `loadedmetadata` fires. The audio source is set after event listeners to avoid race conditions. Added graceful error handling — if the audio fails to load, a fallback "Voice note (Xs)" label is shown instead of a broken player.
  - **DM staff directory (CommunicationsPage.tsx):** Added role badge system: `ROLE_DISPLAY_NAMES` map (e.g. `super_admin` -> "Super Admin", `lab_technician` -> "Lab Tech") and `ROLE_COLORS` map (color-coded per role). Each staff member now shows a circular avatar with initials, a color-coded role badge, and department name. The filter input is now wired — searches by name, role, or department in real-time with a "No staff match" empty state.
  - **Google Meet-style broadcast room (LiveBroadcastModal.tsx):** Complete rewrite as an immersive full-screen meeting room layout: (a) Responsive participant video/avatar grid with name badges, role colors, mute/camera indicators; (b) Broadcaster controls: toggle mic, camera, screen share (via `getDisplayMedia`), end broadcast for everyone; (c) Viewer mode: raise hand, mute toggle; (d) Emoji reaction tray (6 reactions: thumbs up, heart, clap, laugh, party, surprised) with floating animation; (e) Slide-out in-call chat sidebar with real-time messaging; (f) File sharing sidebar with upload and download links; (g) Participants list panel; (h) Top bar with LIVE indicator, participant count, and duration timer. All simulated/fake data removed.
  - **Real-time notification center (NotificationContext.tsx + NotificationBell.tsx + IncomingCallAlert.tsx):** (a) `NotificationProvider` wraps the entire app — maintains a notification array (max 100), unread count, and incoming call state; (b) `NotificationBell` renders a bell icon with unread badge count in the AppShell top bar, with a dropdown drawer showing all notifications sorted newest-first, each with icon, title, body, relative timestamp, and read/unread styling; clicking a notification marks it read and navigates to the relevant module; (c) `IncomingCallAlert` is a full-screen overlay with pulsing avatar, caller name, ring tone (Web Audio API), and Accept/Reject buttons — auto-dismisses after 30s; (d) Notification triggers wired in CommunicationsPage: broadcasts push a "broadcast" notification, DMs push a "dm" notification, calls push a "call_incoming" notification.
  - **App.tsx:** Wrapped app with `NotificationProvider`; added `IncomingCallAlert` overlay at root level; added a top bar with `NotificationBell` above the main content area.
- **Files:**
  - `apps/desktop/src/components/VoiceRecorder.tsx` — durationRef fix, AudioContext cleanup
  - `apps/desktop/src/components/VoiceNotePlayer.tsx` — storedDuration prop, error handling, robust audio loading
  - `apps/desktop/src/components/LiveBroadcastModal.tsx` — complete rewrite as Google Meet-style room
  - `apps/desktop/src/pages/CommunicationsPage.tsx` — role badges, working filter, notification triggers, storedDuration wiring
  - `apps/desktop/src/notifications/NotificationContext.tsx` — new: notification state provider
  - `apps/desktop/src/notifications/NotificationBell.tsx` — new: bell icon + dropdown drawer
  - `apps/desktop/src/notifications/IncomingCallAlert.tsx` — new: full-screen incoming call overlay
  - `apps/desktop/src/App.tsx` — NotificationProvider wrapper, IncomingCallAlert, top bar with bell
- **Verified:** `tsc --noEmit` 0 errors; `vitest run` 3/3 tests pass; `go build ./...` clean; `vite build` succeeds; simulated data removed from broadcast room; notification bell renders in top bar; voice note duration correctly captured and displayed.
- **Status:** Applied

---

## Fix #17 — Communications: staff directory visibility, broadcast permissions, voice note playback, DM notification routing

- **Date:** 2026-08-20
- **Area:** Staff Communications module (Direct Messages + Broadcasts) + RBAC permissions
- **Issue:** Five interconnected bugs in the communications module: (1) The DM staff directory was invisible for non-admin roles because `GET /staff` required `staff.view` permission only granted to `admin`+`super_admin`. Doctors, nurses, pharmacists etc. got HTTP 403 and couldn't see any staff names. (2) The broadcast (announcements) endpoint required `comms.announce` permission only granted to `matron`+`admin`, so all other roles were blocked from posting hospital-wide broadcasts. (3) Broadcast voice notes never played — the `announcementRequest` backend struct only accepted `Body`+`ChannelID` and silently discarded the `attachments` array the frontend sent, so the audio blob was never saved to the database. Additionally, `CreateAnnouncement` store function didn't accept attachments at all. (4) Sending a DM pushed a notification on the sender's own screen (self-notify), cluttering the sender's notification bell with their own outgoing messages. (5) The DM staff directory layout didn't show roles prominently alongside names.
- **Fix:**
  - **Migration 0041** (`0041_communications_access.up.sql`): Grants `staff.view` to all 8 operational roles (nurse, matron, doctor, pharmacist, lab_technician, lab_supervisor, cashier, receptionist) so the DM staff directory is visible to every logged-in user. Grants `comms.announce` to all operational roles so everyone can post hospital-wide broadcasts.
  - **Backend `announcementRequest`** (`comms.go`): Added `Attachments []domain.MessageAttachment` field so the JSON body accepts the attachments array the frontend sends.
  - **Backend `CreateAnnouncement`** (`comms.go`): Updated signature to accept `attachments []domain.MessageAttachment` parameter and pass it through to `sendMessage`, which already supports attachment persistence.
  - **Frontend DM notification** (`CommunicationsPage.tsx`): Removed the `notif.push` call from `sendDm` so the sender never sees a notification for their own outgoing message. DM notifications are delivered server-side to the recipient only.
  - **Frontend staff directory** (`CommunicationsPage.tsx`): Restructured the DM sidebar entry layout so role badges sit inline next to the staff member's name (e.g., avatar initials + "Dr. Chidi Okonkwo" + blue "Doctor" badge), with a second line showing `{jobTitle} • {departmentName}`.
- **Files:**
  - `db/migrations/0041_communications_access.up.sql` (new) — RBAC grants for staff.view + comms.announce
  - `db/migrations/0041_communications_access.down.sql` (new) — revokes those grants
  - `apps/go-api/internal/store/comms.go` — CreateAnnouncement accepts attachments
  - `apps/go-api/internal/httpapi/comms.go` — announcementRequest includes Attachments
  - `apps/desktop/src/pages/CommunicationsPage.tsx` — removed sender self-notification, improved staff directory layout with role badges
- **Verified:** `tsc --noEmit` 0 errors; `vitest run` 3/3 tests pass; `go build ./...` clean; migration 0041 applied to live DB; API tested with curl: doctor1 can now `GET /staff` (returns all staff with roles), doctor1 can `POST /communications/announcements` (was 403 before), voice broadcast with audio attachment saves and returns `storageRef` correctly.
- **Status:** Applied

---

## Fix #18 — Attendance & Clock In/Out: enterprise upgrade (6-tab module, dashboard, leave management, analytics, export)

- **Date:** 2026-08-20
- **Area:** Attendance & Clock In/Out module (frontend + backend + database)
- **Issue:** The Attendance module had only 3 basic tabs (Clock In/Out, Attendance Records, Daily Report) with no dashboard stats, no leave request system, no analytics, and no CSV export. All operational roles had no `attendance.view` permission, so non-admin users couldn't access any attendance features at all.
- **Fix:**
  - **Migration 0042** (`0042_attendance_enterprise.up.sql`): Creates `leave_requests` table. Adds `overtime_minutes` column to `attendance_records`.
  - **Backend `attendance.go`**: Added 5 new HTTP handlers: `handleAttendanceDashboard`, `handleListLeaveRequests`, `handleCreateLeaveRequest`, `handleReviewLeaveRequest`, `handleExportAttendance`.
  - **Backend `store/attendance.go`**: Added `GetAttendanceDashboard`, `ListLeaveRequests`, `CreateLeaveRequest`, `UpdateLeaveRequestStatus` store methods.
  - **Backend `domain.go`**: Added `LeaveRequest` struct. Added `OvertimeMinutes` field to `AttendanceRecord`.
  - **Backend `router.go`**: Registered all new routes with proper permission guards.
  - **Frontend `AttendancePage.tsx`**: Complete rewrite with 6 enterprise tabs — Dashboard, Clock In/Out, Leave Requests, Records, Analytics, Export.
  - **Permission fix**: Granted `attendance.view` to all 8 operational roles.
- **Files:**
  - `db/migrations/0042_attendance_enterprise.up.sql` (new)
  - `db/migrations/0042_attendance_enterprise.down.sql` (new)
  - `apps/go-api/internal/domain/domain.go`
  - `apps/go-api/internal/httpapi/attendance.go`
  - `apps/go-api/internal/store/attendance.go`
  - `apps/go-api/internal/httpapi/router.go`
  - `apps/desktop/src/pages/AttendancePage.tsx`
- **Verified:** `tsc --noEmit` 0 errors; `vitest run` 3/3 tests pass; `go build ./...` clean; API tested with curl against doctor1/nurse1/pharmacist1.
- **Status:** Applied

---

## Fix #19 — Attendance RBAC: role-based tab visibility + super admin-only leave management + Call Back/Revert

- **Date:** 2026-08-20
- **Area:** Attendance module — RBAC enforcement (frontend + backend)
- **Issue:** Three problems: (1) All 6 attendance tabs were visible to every role regardless of seniority. (2) The approve/reject action for leave requests had no role restriction and the action value mismatch (`"approved"` vs `"approve"`) caused all clicks to fail. (3) No way for super admin to call back or revert an already-processed leave decision.
- **Fix:**
  - **Backend `middleware_auth.go`**: Added `requireAttendanceAdmin` middleware + `attendanceAdmin` helper.
  - **Backend `router.go`**: Changed 4 endpoints from `perm("attendance.view")` to `attendanceAdmin()`: GET /attendance, GET /attendance/report, GET /attendance/dashboard, GET /attendance/export.
  - **Backend `attendance.go`**: Moved super_admin check to top of `handleReviewLeaveRequest` so it applies to ALL actions. Fixed switch to accept both `"approve"`/`"approved"` and `"reject"`/`"rejected"`. Added `"revert"` action.
  - **Frontend `AttendancePage.tsx`**: Added `isAdmin` and `isSuperAdmin` flags. Standard staff see only Clock In/Out + My Leave Requests. Admin sees all 6 tabs. SuperAdmin sees amber "Call Back" button on processed requests.
- **Files:**
  - `apps/go-api/internal/httpapi/middleware_auth.go`
  - `apps/go-api/internal/httpapi/router.go`
  - `apps/go-api/internal/httpapi/attendance.go`
  - `apps/desktop/src/pages/AttendancePage.tsx`
- **Verified:** `tsc --noEmit` 0 errors; `vitest run` 3/3 tests pass; `go build ./...` clean. API tested: doctor1 gets 403 on dashboard/records/report/export/approve; matron1 gets 403 on approve; superadmin approve/revert/reject all return 204.
- **Status:** Applied

---
