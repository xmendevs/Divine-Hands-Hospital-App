-- Seed the laboratory test catalogue so the Lab & Pathology module ships with
-- a full set of selectable tests across all major disciplines. Codes use the
-- standard discipline prefixes; prices are indicative Naira values.

-- Sequence for auto-generated codes of manually typed (custom) tests.
CREATE SEQUENCE IF NOT EXISTS lab_tests_no_seq START 1;

INSERT INTO lab_tests (code, name, category, price, specimen_type, container, turnaround_minutes, units, reference_ranges, verification_required)
VALUES
    -- Haematology
    ('FBC', 'Full Blood Count', 'haematology', 5000, 'Whole blood', 'EDTA tube', 60, '', '{}', true),
    ('ESR', 'Erythrocyte Sedimentation Rate', 'haematology', 3000, 'Whole blood', 'EDTA tube', 90, 'mm/hr', '{"low": 0, "high": 20}', false),
    ('PCV', 'Packed Cell Volume', 'haematology', 2500, 'Whole blood', 'EDTA tube', 45, '%', '{"low": 36, "high": 54}', false),
    ('HB', 'Haemoglobin', 'haematology', 2500, 'Whole blood', 'EDTA tube', 45, 'g/dL', '{"low": 12, "high": 17}', true),
    ('WBC', 'White Blood Cell Count', 'haematology', 3000, 'Whole blood', 'EDTA tube', 60, 'x10^9/L', '{"low": 4, "high": 11}', true),
    ('PLT', 'Platelet Count', 'haematology', 3000, 'Whole blood', 'EDTA tube', 60, 'x10^9/L', '{"low": 150, "high": 450}', true),
    ('BG', 'Blood Group & Rhesus', 'haematology', 3000, 'Whole blood', 'EDTA tube', 30, '', '{}', false),
    ('MP', 'Malaria Parasite Test', 'haematology', 3500, 'Whole blood', 'EDTA tube', 45, '', '{}', false),
    ('MPT', 'Malaria Parasite Test (RDT)', 'haematology', 2000, 'Whole blood', 'Lancet/capillary', 20, '', '{}', false),
    ('PT', 'Prothrombin Time', 'haematology', 8000, 'Citrated plasma', 'Sodium citrate tube', 90, 'sec', '{"low": 10, "high": 14}', true),
    ('INR', 'International Normalised Ratio', 'haematology', 8000, 'Citrated plasma', 'Sodium citrate tube', 90, '', '{"low": 0.8, "high": 1.2}', true),
    ('APTT', 'Activated Partial Thromboplastin Time', 'haematology', 9000, 'Citrated plasma', 'Sodium citrate tube', 90, 'sec', '{"low": 25, "high": 35}', true),
    ('GT', 'Genotype', 'haematology', 5000, 'Whole blood', 'EDTA tube', 60, '', '{}', false),
    ('RBC', 'Red Blood Cell Count', 'haematology', 3000, 'Whole blood', 'EDTA tube', 60, 'x10^12/L', '{"low": 4.2, "high": 6.1}', false),
    ('RDW', 'Red Cell Distribution Width', 'haematology', 2500, 'Whole blood', 'EDTA tube', 60, '%', '{"low": 11.5, "high": 14.5}', false),

    -- Clinical chemistry
    ('FBS', 'Fasting Blood Sugar', 'chemistry', 2500, 'Serum', 'Plain tube', 45, 'mmol/L', '{"low": 3.9, "high": 6.1}', false),
    ('RBS', 'Random Blood Sugar', 'chemistry', 2500, 'Serum', 'Plain tube', 30, 'mmol/L', '{"low": 3.9, "high": 7.8}', false),
    ('HBA1C', 'Glycated Haemoglobin (HbA1c)', 'chemistry', 12000, 'Whole blood', 'EDTA tube', 120, '%', '{"low": 4, "high": 5.6}', true),
    ('LFT', 'Liver Function Test', 'chemistry', 12000, 'Serum', 'Plain tube', 120, '', '{}', true),
    ('AST', 'Aspartate Transaminase', 'chemistry', 4000, 'Serum', 'Plain tube', 90, 'U/L', '{"low": 10, "high": 40}', false),
    ('ALT', 'Alanine Transaminase', 'chemistry', 4000, 'Serum', 'Plain tube', 90, 'U/L', '{"low": 7, "high": 56}', false),
    ('ALP', 'Alkaline Phosphatase', 'chemistry', 4000, 'Serum', 'Plain tube', 90, 'U/L', '{"low": 44, "high": 147}', false),
    ('BIL', 'Bilirubin (Total)', 'chemistry', 4000, 'Serum', 'Plain tube', 90, 'mg/dL', '{"low": 0.1, "high": 1.2}', false),
    ('UREA', 'Urea', 'chemistry', 3500, 'Serum', 'Plain tube', 90, 'mmol/L', '{"low": 2.5, "high": 7.1}', false),
    ('CREAT', 'Creatinine', 'chemistry', 3500, 'Serum', 'Plain tube', 90, 'mg/dL', '{"low": 0.6, "high": 1.3}', true),
    ('RFT', 'Renal Function Test', 'chemistry', 12000, 'Serum', 'Plain tube', 120, '', '{}', true),
    ('UA', 'Uric Acid', 'chemistry', 4000, 'Serum', 'Plain tube', 90, 'mg/dL', '{"low": 3.4, "high": 7.0}', false),
    ('CHOL', 'Total Cholesterol', 'chemistry', 4500, 'Serum', 'Plain tube', 90, 'mmol/L', '{"low": 0, "high": 5.2}', false),
    ('TRIG', 'Triglycerides', 'chemistry', 4500, 'Serum', 'Plain tube', 90, 'mmol/L', '{"low": 0, "high": 1.7}', false),
    ('HDL', 'HDL Cholesterol', 'chemistry', 4500, 'Serum', 'Plain tube', 90, 'mmol/L', '{"low": 1.0, "high": 99}', false),
    ('LDL', 'LDL Cholesterol', 'chemistry', 4500, 'Serum', 'Plain tube', 90, 'mmol/L', '{"low": 0, "high": 3.4}', false),
    ('LIPID', 'Lipid Profile', 'chemistry', 15000, 'Serum', 'Plain tube', 120, '', '{}', false),
    ('ELEC', 'Serum Electrolytes (Na, K, Cl, HCO3)', 'chemistry', 9000, 'Serum', 'Plain tube', 90, '', '{}', true),
    ('NA', 'Sodium', 'chemistry', 3000, 'Serum', 'Plain tube', 60, 'mmol/L', '{"low": 135, "high": 145}', false),
    ('K', 'Potassium', 'chemistry', 3000, 'Serum', 'Plain tube', 60, 'mmol/L', '{"low": 3.5, "high": 5.0}', true),
    ('CL', 'Chloride', 'chemistry', 3000, 'Serum', 'Plain tube', 60, 'mmol/L', '{"low": 98, "high": 106}', false),
    ('HCO3', 'Bicarbonate', 'chemistry', 3000, 'Serum', 'Plain tube', 60, 'mmol/L', '{"low": 22, "high": 28}', false),
    ('TP', 'Total Protein', 'chemistry', 3500, 'Serum', 'Plain tube', 90, 'g/L', '{"low": 60, "high": 83}', false),
    ('ALB', 'Albumin', 'chemistry', 3500, 'Serum', 'Plain tube', 90, 'g/L', '{"low": 35, "high": 52}', false),
    ('PSA', 'Prostate Specific Antigen', 'chemistry', 15000, 'Serum', 'Plain tube', 120, 'ng/mL', '{"low": 0, "high": 4.0}', true),
    ('TFT', 'Thyroid Function Test', 'chemistry', 15000, 'Serum', 'Plain tube', 120, '', '{}', false),
    ('TSH', 'Thyroid Stimulating Hormone', 'chemistry', 8000, 'Serum', 'Plain tube', 120, 'mIU/L', '{"low": 0.4, "high": 4.0}', false),
    ('FT4', 'Free Thyroxine (FT4)', 'chemistry', 8000, 'Serum', 'Plain tube', 120, 'pmol/L', '{"low": 9, "high": 19}', false),
    ('CPK', 'Creatine Kinase', 'chemistry', 8000, 'Serum', 'Plain tube', 90, 'U/L', '{"low": 39, "high": 308}', false),
    ('TROP', 'Troponin I', 'chemistry', 20000, 'Serum', 'Plain tube', 60, 'ng/mL', '{"low": 0, "high": 0.04}', true),
    ('AMY', 'Amylase', 'chemistry', 8000, 'Serum', 'Plain tube', 90, 'U/L', '{"low": 30, "high": 110}', false),
    ('CRP', 'C-Reactive Protein', 'chemistry', 8000, 'Serum', 'Plain tube', 90, 'mg/L', '{"low": 0, "high": 5}', false),

    -- Microbiology
    ('MCS', 'Mid-stream Urine M/C/S', 'microbiology', 8000, 'Urine', 'Sterile container', 1440, '', '{}', false),
    ('STOOL_MCS', 'Stool M/C/S', 'microbiology', 9000, 'Stool', 'Sterile container', 1440, '', '{}', false),
    ('WOUND_MCS', 'Wound Swab M/C/S', 'microbiology', 9000, 'Swab', 'Stuart transport medium', 1440, '', '{}', false),
    ('BLOOD_CX', 'Blood Culture', 'microbiology', 15000, 'Blood', 'Blood culture bottle', 2880, '', '{}', true),
    ('CSP', 'Cerebrospinal Fluid Analysis', 'microbiology', 12000, 'CSF', 'Sterile tube', 120, '', '{}', true),
    ('AFB', 'Acid-Fast Bacilli (TB) Smear', 'microbiology', 6000, 'Sputum', 'Sterile container', 1440, '', '{}', false),
    ('URINE_PREGNANCY', 'Urine Pregnancy Test', 'microbiology', 2000, 'Urine', 'Sterile container', 20, '', '{}', false),
    ('WIDAL', 'Widal Test', 'microbiology', 3500, 'Serum', 'Plain tube', 60, '', '{}', false),
    ('VDRL', 'VDRL / Syphilis Screen', 'microbiology', 3000, 'Serum', 'Plain tube', 60, '', '{}', false),
    ('GRAM', 'Gram Stain', 'microbiology', 3000, 'Smear', 'Glass slide', 45, '', '{}', false),

    -- Immunology / serology
    ('HIV', 'HIV Screening (1 & 2)', 'immunology', 3000, 'Serum', 'Plain tube', 30, '', '{}', false),
    ('HBSAG', 'Hepatitis B Surface Antigen', 'immunology', 4000, 'Serum', 'Plain tube', 60, '', '{}', false),
    ('HCV', 'Hepatitis C Antibody', 'immunology', 5000, 'Serum', 'Plain tube', 60, '', '{}', false),
    ('RF', 'Rheumatoid Factor', 'immunology', 6000, 'Serum', 'Plain tube', 90, 'IU/mL', '{"low": 0, "high": 14}', false),
    ('ASO', 'Anti-Streptolysin O Titre', 'immunology', 6000, 'Serum', 'Plain tube', 90, 'IU/mL', '{"low": 0, "high": 200}', false),
    ('ANP', 'Antinuclear Antibody (ANA)', 'immunology', 12000, 'Serum', 'Plain tube', 1440, '', '{}', false),
    ('CD4', 'CD4 Count', 'immunology', 18000, 'Whole blood', 'EDTA tube', 120, 'cells/uL', '{"low": 500, "high": 1500}', false),

    -- Urinalysis
    ('URO', 'Urinalysis (Dipstick)', 'urinalysis', 2500, 'Urine', 'Sterile container', 30, '', '{}', false),
    ('URO_MIC', 'Urine Microscopy', 'urinalysis', 3000, 'Urine', 'Sterile container', 45, '', '{}', false),
    ('24H_URINE', '24-Hour Urine Protein', 'urinalysis', 12000, 'Urine (24h)', '24-hour container', 1440, 'g/24h', '{"low": 0, "high": 0.15}', false),

    -- Other
    ('ESR_OTHER', 'ESR (Westergren)', 'other', 3000, 'Whole blood', 'Sodium citrate tube', 90, 'mm/hr', '{"low": 0, "high": 20}', false),
    ('GXM', 'Group & Cross-match', 'other', 8000, 'Whole blood', 'EDTA tube', 90, '', '{}', true)
ON CONFLICT (code) DO NOTHING;
