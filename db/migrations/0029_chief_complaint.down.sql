-- Rollback of 0029: restore the original section whitelist.
ALTER TABLE patient_clinical_entries DROP CONSTRAINT patient_clinical_entries_section_check;
ALTER TABLE patient_clinical_entries ADD CONSTRAINT patient_clinical_entries_section_check CHECK (section IN (
    'allergy', 'medical_history', 'surgical_history', 'chronic_condition',
    'medication', 'family_history', 'social_history'
));
