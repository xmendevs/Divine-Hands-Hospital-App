package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Manifest describes one encrypted backup: enough metadata to verify it and
// to restore it on a replacement server without the original database.
type Manifest struct {
	Version          int      `json:"version"`
	BackupID         string   `json:"backupId"`
	CreatedAt        string   `json:"createdAt"` // RFC3339 UTC
	Format           string   `json:"format"`    // e.g. pg_plain_gzip_aes256gcm
	Target           string   `json:"target"`    // file name of the encrypted payload
	SizeBytes        int64    `json:"sizeBytes"`
	SHA256           string   `json:"sha256"`
	KeyID            string   `json:"keyId"`
	Database         string   `json:"database"`
	MigrationVersion int64    `json:"migrationVersion"`
	ConfigFiles      []string `json:"configFiles,omitempty"` // names of encrypted config payloads
	PGVersion        string   `json:"pgVersion,omitempty"`
}

// ReadManifest loads and validates a manifest file.
func ReadManifest(path string) (*Manifest, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("invalid manifest: %w", err)
	}
	if m.Version != 1 || m.BackupID == "" || m.SHA256 == "" || m.Target == "" {
		return nil, fmt.Errorf("invalid manifest: missing required fields")
	}
	return &m, nil
}

// WriteManifest stores the manifest next to the payload.
func WriteManifest(path string, m *Manifest) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// SHA256File computes the checksum of a file.
func SHA256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := copyAll(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// newManifest builds a manifest for an encrypted payload.
func newManifest(backupID, target, database string, size int64, sha string, key []byte, migrationVersion int64, pgVersion string, configFiles []string) *Manifest {
	return &Manifest{
		Version:          1,
		BackupID:         backupID,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
		Format:           "pg_plain_gzip_aes256gcm",
		Target:           target,
		SizeBytes:        size,
		SHA256:           sha,
		KeyID:            KeyID(key),
		Database:         database,
		MigrationVersion: migrationVersion,
		ConfigFiles:      configFiles,
		PGVersion:        pgVersion,
	}
}
