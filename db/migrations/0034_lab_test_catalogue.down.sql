-- Remove the seeded catalogue entries (only the ones added by this seed —
-- tests created manually via the UI keep their codes).
DROP SEQUENCE IF EXISTS lab_tests_no_seq;

DELETE FROM lab_tests
WHERE code IN (
    'ESR','PCV','HB','WBC','PLT','BG','MP','MPT','PT','INR','APTT','GT','RBC','RDW',
    'FBS','RBS','HBA1C','LFT','AST','ALT','ALP','BIL','UREA','CREAT','RFT','UA',
    'CHOL','TRIG','HDL','LDL','LIPID','ELEC','NA','K','CL','HCO3','TP','ALB','PSA',
    'TFT','TSH','FT4','CPK','TROP','AMY','CRP',
    'MCS','STOOL_MCS','WOUND_MCS','BLOOD_CX','CSP','AFB','URINE_PREGNANCY','WIDAL','VDRL','GRAM',
    'HIV','HBSAG','HCV','RF','ASO','ANP','CD4',
    'URO','URO_MIC','24H_URINE',
    'ESR_OTHER','GXM'
);
