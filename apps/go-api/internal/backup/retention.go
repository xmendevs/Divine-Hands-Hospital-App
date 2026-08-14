package backup

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// RetentionPolicy implements tiered retention. Daily backups are kept for
// RetentionDaily days, weekly (Sunday) backups for RetentionWeekly weeks, and
// monthly (1st of the month) backups for RetentionMonthly months. Tiers are
// named after the calendar slot they were promoted to, so promotion is
// idempotent across reruns.
type RetentionPolicy struct {
	Daily   int
	Weekly  int
	Monthly int
}

// tierName returns the canonical file name for a backup, including its
// promotion tier. Same-tier backups on the same day overwrite each other,
// which naturally enforces "one backup per calendar slot".
func tierName(t time.Time) (string, string, error) {
	if t.Weekday() == time.Sunday {
		return "weekly", fmt.Sprintf("backup_weekly_%s.sql.gz.enc", t.Format("2006-01-02")), nil
	}
	if t.Day() == 1 {
		return "monthly", fmt.Sprintf("backup_monthly_%s.sql.gz.enc", t.Format("2006-01-02")), nil
	}
	return "daily", fmt.Sprintf("backup_daily_%s.sql.gz.enc", t.Format("2006-01-02")), nil
}

// pruneLocal removes expired backups from dir based on the tier in the file
// name, returning the number of deleted files.
func pruneLocal(dir string, policy RetentionPolicy, now time.Time) (int, error) {
	if policy.Daily <= 0 {
		policy.Daily = 7
	}
	if policy.Weekly <= 0 {
		policy.Weekly = 4
	}
	if policy.Monthly <= 0 {
		policy.Monthly = 3
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}

	// Expiry per tier: a file in tier X is kept if its date is within the
	// retention window (weekly/monthly windows are expressed in weeks/months
	// so that at least one representative is always retained).
	expired := func(name string) bool {
		t, tier, err := parseBackupName(name)
		if err != nil {
			return false // unknown names are never pruned
		}
		switch tier {
		case "daily":
			return now.Sub(t) > time.Duration(policy.Daily)*24*time.Hour
		case "weekly":
			return now.Sub(t) > time.Duration(policy.Weekly)*7*24*time.Hour
		case "monthly":
			return now.Sub(t) > time.Duration(policy.Monthly)*31*24*time.Hour
		}
		return false
	}

	removed := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".enc") {
			continue
		}
		if expired(e.Name()) {
			if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
				removed++
			}
		}
	}
	return removed, nil
}

// parseBackupName extracts the date and tier from a backup file name.
func parseBackupName(name string) (time.Time, string, error) {
	for _, tier := range []string{"weekly", "monthly", "daily"} {
		prefix := "backup_" + tier + "_"
		if strings.HasPrefix(name, prefix) {
			rest := strings.TrimPrefix(name, prefix)
			date := strings.TrimSuffix(rest, ".sql.gz.enc")
			t, err := time.Parse("2006-01-02", date)
			if err != nil {
				return time.Time{}, "", err
			}
			return t, tier, nil
		}
	}
	return time.Time{}, "", fmt.Errorf("not a backup file: %s", name)
}

// pruneCloud deletes objects beyond the newest retentionCount, oldest first.
func pruneCloud(objs []ObjectInfo, retentionCount int) []ObjectInfo {
	if retentionCount <= 0 {
		retentionCount = 30
	}
	if len(objs) <= retentionCount {
		return nil
	}
	sort.Slice(objs, func(i, j int) bool { return objs[i].Key < objs[j].Key })
	return objs[:len(objs)-retentionCount]
}
