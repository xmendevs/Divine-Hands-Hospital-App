-- Patient photo (snapped or uploaded): stored as base64 data with its content
-- type so the image is available on every client without shared object storage.
ALTER TABLE patients ADD COLUMN photo_data TEXT NOT NULL DEFAULT '';
ALTER TABLE patients ADD COLUMN photo_content_type TEXT NOT NULL DEFAULT '';
