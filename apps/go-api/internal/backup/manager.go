// Manager orchestrates backup, upload, retention, verification and alerting.
package backup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Config is the full backup service configuration.
type Config struct {
	Enabled        bool
	LocalDir       string
	S3             *S3Config   // object-storage destination
	Neon           *NeonConfig // Neon Postgres destination (alternative to S3)
	EncryptionKey  []byte      // 32 bytes, hex-decoded by the caller
	PGDumpPath     string
	DatabaseURL    string
	MigrationsDir  string
	ConfigFiles    []string
	Retention      RetentionPolicy
	LocalInterval  time.Duration
	CloudInterval  time.Duration
	VerifyInterval time.Duration
}

// Ledger is the persistence interface for backup jobs (satisfied by *store.Store).
type Ledger interface {
	InsertBackupJob(ctx context.Context, j domain.BackupJob) (string, error)
	UpdateBackupJob(ctx context.Context, id string, j domain.BackupJob) error
	ListBackupJobs(ctx context.Context, limit int) ([]domain.BackupJob, error)
	BackupStatusSummary(ctx context.Context) (domain.BackupStatus, error)
}

// Alerter notifies administrators when a backup fails (satisfied by *store.Store).
type Alerter interface {
	NotifyAdmins(ctx context.Context, title, body, link string) error
}

// Manager serializes all backup work (scheduled or manual) and records every
// attempt in the ledger.
type Manager struct {
	cfg    Config
	ledger Ledger
	alert  Alerter
	mu     sync.Mutex
	now    func() time.Time
	logf   func(format string, args ...any)

	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewManager builds a manager. now may be nil (defaults to time.Now).
func NewManager(cfg Config, ledger Ledger, alert Alerter, now func() time.Time) *Manager {
	if now == nil {
		now = time.Now
	}
	if cfg.LocalInterval == 0 {
		cfg.LocalInterval = 24 * time.Hour
	}
	if cfg.CloudInterval == 0 {
		cfg.CloudInterval = 24 * time.Hour
	}
	if cfg.VerifyInterval == 0 {
		cfg.VerifyInterval = 24 * time.Hour
	}
	return &Manager{cfg: cfg, ledger: ledger, alert: alert, now: now, logf: func(string, ...any) {}}
}

// SetLogger installs a structured log sink for scheduler output.
func (m *Manager) SetLogger(f func(format string, args ...any)) {
	if f != nil {
		m.logf = f
	}
}

type jobResult struct {
	target   string
	size     int64
	checksum string
	details  []byte
}

// runJob records the job in the ledger, runs fn, finalizes the ledger row and
// raises an alert on failure.
func (m *Manager) runJob(ctx context.Context, jobType string, fn func(ctx context.Context, res *jobResult) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	started := m.now().UTC()
	j := domain.BackupJob{
		JobType:   jobType,
		Status:    domain.BackupJobStatusRunning,
		StartedAt: started,
		Details:   []byte("{}"),
	}
	id, err := m.ledger.InsertBackupJob(ctx, j)
	if err != nil {
		return fmt.Errorf("record job start: %w", err)
	}

	var res jobResult
	err = fn(ctx, &res)
	finished := m.now().UTC()
	j.ID = id
	j.FinishedAt = &finished
	j.Target = res.target
	j.SizeBytes = res.size
	j.Checksum = res.checksum
	if res.details != nil {
		j.Details = res.details
	}
	if err != nil {
		j.Status = domain.BackupJobStatusFailed
		j.ErrorMessage = err.Error()
	} else {
		j.Status = domain.BackupJobStatusSuccess
	}
	if uerr := m.ledger.UpdateBackupJob(ctx, id, j); uerr != nil {
		return fmt.Errorf("record job result: %w", uerr)
	}
	if err != nil {
		m.logf("backup job %s failed: %v", jobType, err)
		if m.alert != nil {
			if aerr := m.alert.NotifyAdmins(ctx, "Backup failure",
				fmt.Sprintf("A %s backup failed: %s", jobType, err.Error()),
				"/settings/backups"); aerr != nil {
				m.logf("backup alert failed: %v", aerr)
			}
		}
		return err
	}
	m.logf("backup job %s succeeded: %s (%d bytes)", jobType, res.target, res.size)
	return nil
}

// RunLocal takes a full local backup: dump, compress, encrypt, manifest,
// config files, retention pruning.
func (m *Manager) RunLocal(ctx context.Context) error {
	if !m.cfg.Enabled {
		return errors.New("backup service is not enabled")
	}
	return m.runJob(ctx, domain.BackupJobLocal, m.doLocal)
}

func (m *Manager) doLocal(ctx context.Context, res *jobResult) error {
	if err := os.MkdirAll(m.cfg.LocalDir, 0o750); err != nil {
		return err
	}
	now := m.now()
	tier, name, err := tierName(now)
	if err != nil {
		return err
	}

	tmp, err := os.MkdirTemp("", "hims-backup-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	plainPath := filepath.Join(tmp, "dump.sql.gz")
	dump, err := Dump(ctx, m.cfg.PGDumpPath, m.cfg.DatabaseURL, plainPath)
	if err != nil {
		return err
	}

	encPath := filepath.Join(m.cfg.LocalDir, name)
	if err := EncryptFile(m.cfg.EncryptionKey, plainPath, encPath); err != nil {
		return err
	}
	encSHA, err := SHA256File(encPath)
	if err != nil {
		return err
	}
	info, err := os.Stat(encPath)
	if err != nil {
		return err
	}

	configNames, err := m.backupConfigFiles(ctx, tier, now)
	if err != nil {
		return err
	}

	backupID := fmt.Sprintf("%s-%d", strings.TrimSuffix(name, ".sql.gz.enc"), now.Unix())
	manifest := newManifest(backupID, name, m.databaseName(), info.Size(), dump.SHA256,
		m.cfg.EncryptionKey, migrationVersionOf(ctx, m.cfg.DatabaseURL), dump.PGVersion, configNames)
	if err := WriteManifest(m.manifestPath(name), manifest); err != nil {
		return err
	}

	pruned, err := pruneLocal(m.cfg.LocalDir, m.cfg.Retention, now)
	if err != nil {
		return err
	}

	details, _ := json.Marshal(map[string]any{"tier": tier, "manifest": manifest, "pruned": pruned})
	res.target = name
	res.size = info.Size()
	res.checksum = encSHA
	res.details = details
	return nil
}

// backupConfigFiles encrypts the configured config files into the local
// backup directory so a replacement server can be rebuilt. Returns the
// payload names for the manifest.
func (m *Manager) backupConfigFiles(ctx context.Context, tier string, now time.Time) ([]string, error) {
	var names []string
	for _, path := range m.cfg.ConfigFiles {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		encPath := filepath.Join(m.cfg.LocalDir, fmt.Sprintf("config_%s_%s.enc",
			strings.ReplaceAll(filepath.Base(path), ".", "_"), now.Format("2006-01-02")))
		if err := EncryptFile(m.cfg.EncryptionKey, path, encPath); err != nil {
			return names, fmt.Errorf("backup config %s: %w", path, err)
		}
		names = append(names, filepath.Base(encPath))
	}
	return names, nil
}

// RunCloud pushes the current local backup (creating it first) to the
// configured cloud destination. For S3 that means uploading the encrypted
// payload; for Neon it means restoring a fresh dump into the Neon database.
func (m *Manager) RunCloud(ctx context.Context) error {
	if !m.cfg.Enabled {
		return errors.New("backup service is not enabled")
	}
	if m.cfg.S3 == nil && m.cfg.Neon == nil {
		return errors.New("cloud backup is not configured")
	}
	return m.runJob(ctx, domain.BackupJobCloud, m.doCloud)
}

func (m *Manager) doCloud(ctx context.Context, res *jobResult) error {
	if m.cfg.Neon != nil {
		return m.doCloudNeon(ctx, res)
	}
	if err := m.doLocal(ctx, res); err != nil {
		return err
	}
	client := NewS3Client(*m.cfg.S3, m.now)
	prefix := strings.Trim(m.cfg.S3.Prefix, "/")

	payload := filepath.Join(m.cfg.LocalDir, res.target)
	if err := m.uploadFile(ctx, client, prefix+"backups/"+res.target, payload); err != nil {
		return fmt.Errorf("upload backup: %w", err)
	}
	manifest, err := ReadManifest(m.manifestPath(res.target))
	if err != nil {
		return err
	}
	for _, c := range manifest.ConfigFiles {
		if err := m.uploadFile(ctx, client, prefix+"configs/"+c,
			filepath.Join(m.cfg.LocalDir, c)); err != nil {
			return fmt.Errorf("upload config %s: %w", c, err)
		}
	}
	if err := m.uploadFile(ctx, client, prefix+"manifests/manifest.json",
		m.manifestPath(res.target)); err != nil {
		return fmt.Errorf("upload manifest: %w", err)
	}

	// Retention: keep the newest N backups and their manifests.
	objs, err := client.ListObjects(ctx, prefix+"backups/")
	if err != nil {
		return fmt.Errorf("list cloud backups: %w", err)
	}
	toDelete := pruneCloud(objs, m.cfg.RetentionCloud())
	for _, o := range toDelete {
		if err := client.DeleteObject(ctx, o.Key); err != nil {
			m.logf("delete cloud object %s: %v", o.Key, err)
		}
	}

	details, _ := json.Marshal(map[string]any{"object": prefix + "backups/" + res.target, "deleted": len(toDelete)})
	res.details = details
	return nil
}

// doCloudNeon keeps the encrypted local backup (doLocal) and additionally
// restores a fresh dump into the Neon database, replacing its data with the
// latest snapshot. Neon keeps no per-run history; the local backups do.
func (m *Manager) doCloudNeon(ctx context.Context, res *jobResult) error {
	if err := m.doLocal(ctx, res); err != nil {
		return err
	}

	tmp, err := os.MkdirTemp("", "hims-neon-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	plainPath := filepath.Join(tmp, "dump.sql.gz")
	if _, err := Dump(ctx, m.cfg.PGDumpPath, m.cfg.DatabaseURL, plainPath); err != nil {
		return fmt.Errorf("dump for neon restore: %w", err)
	}
	restored, err := RestoreToNeon(ctx, m.cfg.Neon.ConnectionString, plainPath)
	if err != nil {
		return fmt.Errorf("restore to neon: %w", err)
	}

	details, _ := json.Marshal(map[string]any{"destination": "neon", "restore": restored})
	res.details = details
	return nil
}

func (m *Manager) uploadFile(ctx context.Context, client *S3Client, key, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	sha, err := SHA256File(path)
	if err != nil {
		return err
	}
	return client.PutObject(ctx, key, f, info.Size(), sha)
}

// Verify restores the newest backup into an isolated scratch database and
// validates schema, data and checksums.
func (m *Manager) Verify(ctx context.Context) (*VerifyResult, error) {
	if !m.cfg.Enabled {
		return nil, errors.New("backup service is not enabled")
	}
	var res *VerifyResult
	err := m.runJob(ctx, domain.BackupJobVerification, func(ctx context.Context, jr *jobResult) error {
		v, err := m.doVerify(ctx, jr)
		if err != nil {
			return err
		}
		res = v
		return nil
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (m *Manager) doVerify(ctx context.Context, jr *jobResult) (*VerifyResult, error) {
	payload, manifestPath, err := m.newestBackup(ctx)
	if err != nil {
		return nil, err
	}

	var manifest *Manifest
	var manifestBytes []byte
	if manifestPath != "" {
		if mb, err := os.ReadFile(manifestPath); err == nil {
			if mf, err := ReadManifest(manifestPath); err == nil {
				manifest = mf
				manifestBytes = mb
			}
		}
	}

	tmp, err := os.MkdirTemp("", "hims-verify-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)

	decPath := filepath.Join(tmp, "backup.sql.gz")
	if err := DecryptFile(m.cfg.EncryptionKey, payload, decPath); err != nil {
		return nil, fmt.Errorf("decrypt backup: %w", err)
	}

	expect := ""
	if manifest != nil {
		expect = manifest.SHA256
	}
	ver, err := VerifyRestore(ctx, m.cfg.DatabaseURL, decPath, m.cfg.MigrationsDir, expect)
	if err != nil {
		return nil, err
	}

	details, _ := json.Marshal(map[string]any{
		"verify":   ver,
		"manifest": json.RawMessage(manifestBytes),
	})
	jr.target = filepath.Base(payload)
	jr.details = details
	return ver, nil
}

// newestBackup returns the path of the newest local payload (or downloads the
// newest cloud payload), plus the path of its manifest sidecar when known.
func (m *Manager) newestBackup(ctx context.Context) (string, string, error) {
	if m.cfg.LocalDir != "" {
		if p := newestLocal(m.cfg.LocalDir); p != "" {
			base := strings.TrimSuffix(filepath.Base(p), ".sql.gz.enc")
			mp := filepath.Join(m.cfg.LocalDir, "manifest_"+base+".json")
			if _, err := os.Stat(mp); err == nil {
				return p, mp, nil
			}
			return p, "", nil
		}
	}
	if m.cfg.S3 == nil {
		return "", "", errors.New("no backup available for verification")
	}
	client := NewS3Client(*m.cfg.S3, m.now)
	prefix := strings.Trim(m.cfg.S3.Prefix, "/")
	objs, err := client.ListObjects(ctx, prefix+"backups/")
	if err != nil {
		return "", "", err
	}
	if len(objs) == 0 {
		return "", "", errors.New("no backup available for verification")
	}
	sort.Slice(objs, func(i, j int) bool { return objs[i].Key > objs[j].Key })
	tmp, err := os.MkdirTemp("", "hims-dl-*")
	if err != nil {
		return "", "", err
	}
	local := filepath.Join(tmp, filepath.Base(objs[0].Key))
	if err := client.GetObjectToFile(ctx, objs[0].Key, local); err != nil {
		return "", "", err
	}
	mp, err := os.CreateTemp("", "hims-manifest-*.json")
	if err != nil {
		return "", "", err
	}
	defer mp.Close()
	manifestKey := prefix + "manifests/manifest.json"
	if mb, err := client.GetObjectBytes(ctx, manifestKey); err == nil {
		_ = os.WriteFile(mp.Name(), mb, 0o600)
		return local, mp.Name(), nil
	}
	return local, "", nil
}

func newestLocal(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var best string
	var bestTime time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql.gz.enc") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(bestTime) {
			bestTime = info.ModTime()
			best = filepath.Join(dir, e.Name())
		}
	}
	return best
}

func (m *Manager) manifestPath(payloadName string) string {
	base := strings.TrimSuffix(payloadName, ".sql.gz.enc")
	return filepath.Join(m.cfg.LocalDir, "manifest_"+base+".json")
}

func (m *Manager) databaseName() string {
	parts := strings.Split(m.cfg.DatabaseURL, "/")
	return parts[len(parts)-1]
}

// RetentionCloud is the number of newest backups the cloud keeps: the largest
// of the local tier windows, so cloud retention never drops a tier a local
// policy would still keep.
func (c Config) RetentionCloud() int {
	best := c.Retention.Daily
	if c.Retention.Weekly > best {
		best = c.Retention.Weekly
	}
	if c.Retention.Monthly > best {
		best = c.Retention.Monthly
	}
	if best <= 0 {
		return 30
	}
	return best
}

// Status returns the full dashboard summary, including presentation fields
// (health, age, storage, next scheduled runs) that only the manager knows.
func (m *Manager) Status(ctx context.Context) (domain.BackupStatus, error) {
	st, err := m.ledger.BackupStatusSummary(ctx)
	if err != nil {
		return st, err
	}
	m.DecorateStatus(&st)
	return st, nil
}

// DecorateStatus fills presentation fields on a raw ledger summary.
func (m *Manager) DecorateStatus(st *domain.BackupStatus) {
	st.Enabled = m.cfg.Enabled
	if !m.cfg.Enabled {
		st.HealthStatus = "disabled"
		return
	}
	healthy := func(j *domain.BackupJob) bool {
		if j == nil || j.Status != domain.BackupJobStatusSuccess || j.FinishedAt == nil {
			return false
		}
		return m.now().Sub(*j.FinishedAt) < 36*time.Hour
	}
	st.LocalHealthy = healthy(st.LastLocal)
	st.CloudHealthy = healthy(st.LastCloud)

	// Overall health for the dashboard banner: healthy only when a local
	// backup exists and every configured cloud destination is healthy. A
	// cloud target that is configured but never succeeded is degraded, not
	// healthy.
	cloudConfigured := m.cfg.S3 != nil || m.cfg.Neon != nil
	switch {
	case !st.LocalHealthy:
		st.HealthStatus = "local_backup_unhealthy"
	case cloudConfigured && !st.CloudHealthy:
		st.HealthStatus = "cloud_backup_unhealthy"
	case st.FailedLast24h > 0:
		st.HealthStatus = "recent_failures"
	default:
		st.HealthStatus = "healthy"
	}

	finished := func(j *domain.BackupJob) time.Time {
		if j != nil && j.FinishedAt != nil {
			return *j.FinishedAt
		}
		return time.Time{}
	}
	lt, ct := finished(st.LastLocal), finished(st.LastCloud)
	recent := lt
	if ct.After(recent) {
		recent = ct
	}
	if !recent.IsZero() {
		st.BackupAgeHours = m.now().Sub(recent).Hours()
	}

	st.StorageBytes = localStorageBytes(m.cfg.LocalDir)

	if m.cfg.LocalInterval > 0 {
		next := m.now().Add(m.cfg.LocalInterval).UTC().Format(time.RFC3339)
		st.NextLocalAt = &next
	}
	if (m.cfg.S3 != nil || m.cfg.Neon != nil) && m.cfg.CloudInterval > 0 {
		next := m.now().Add(m.cfg.CloudInterval).UTC().Format(time.RFC3339)
		st.NextCloudAt = &next
	}
	if m.cfg.VerifyInterval > 0 {
		next := m.now().Add(m.cfg.VerifyInterval).UTC().Format(time.RFC3339)
		st.NextVerifyAt = &next
	}
}

func localStorageBytes(dir string) int64 {
	var total int64
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if info, err := e.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

// Start launches the scheduler. Local/cloud back up immediately on startup,
// then on their intervals; verification runs only after its interval so the
// first verification exercises a real backup.
func (m *Manager) Start(ctx context.Context) {
	m.start(ctx, true)
}

// StartDelayed launches the scheduler without the immediate first run. Used
// when the manager is rebuilt after a settings change: the settings save loop
// PUTs one key at a time, and an immediate run per PUT would abort in-flight
// restores (for Neon that leaves the destination half-restored).
func (m *Manager) StartDelayed(ctx context.Context) {
	m.start(ctx, false)
}

func (m *Manager) start(ctx context.Context, immediate bool) {
	ctx, m.cancel = context.WithCancel(ctx)
	if m.cfg.Enabled && m.cfg.LocalInterval > 0 {
		m.wg.Add(1)
		go m.loop(ctx, "local", m.cfg.LocalInterval, m.RunLocal, immediate)
	}
	if m.cfg.Enabled && (m.cfg.S3 != nil || m.cfg.Neon != nil) && m.cfg.CloudInterval > 0 {
		m.wg.Add(1)
		go m.loop(ctx, "cloud", m.cfg.CloudInterval, m.RunCloud, immediate)
	}
	if m.cfg.Enabled && m.cfg.VerifyInterval > 0 {
		m.wg.Add(1)
		go m.loop(ctx, "verify", m.cfg.VerifyInterval, func(ctx context.Context) error {
			_, err := m.Verify(ctx)
			return err
		}, false)
	}
}

// Stop cancels the scheduler and waits for in-flight runs.
func (m *Manager) Stop() {
	if m.cancel != nil {
		m.cancel()
		m.wg.Wait()
	}
}

func (m *Manager) loop(ctx context.Context, name string, interval time.Duration, fn func(context.Context) error, runNow bool) {
	defer m.wg.Done()
	timer := time.NewTimer(interval)
	if runNow {
		timer.Stop()
		timer = time.NewTimer(0)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			tctx, cancel := context.WithTimeout(ctx, interval)
			if err := fn(tctx); err != nil {
				m.logf("scheduled %s backup: %v", name, err)
			}
			cancel()
			timer.Reset(interval)
		}
	}
}
