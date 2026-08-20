-- Add the chief complaint (current complaint) clinical section.
ALTER TABLE patient_clinical_entries DROP CONSTRAINT patient_clinical_entries_section_check;
ALTER TABLE patient_clinical_entries ADD CONSTRAINT patient_clinical_entries_section_check CHECK (section IN (
    'chief_complaint', 'allergy', 'medical_history', 'surgical_history',
    'chronic_condition', 'medication', 'family_history', 'social_history'
));
