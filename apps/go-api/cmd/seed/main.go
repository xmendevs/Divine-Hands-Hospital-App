package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

func main() {
	username := getenv("SEED_SUPERADMIN_USERNAME", "superadmin")
	password := os.Getenv("SEED_SUPERADMIN_PASSWORD")
	if password == "" {
		log.Fatal("SEED_SUPERADMIN_PASSWORD is required")
	}
	email := getenv("SEED_SUPERADMIN_EMAIL", "superadmin@example.com")
	employeeNo := getenv("SEED_SUPERADMIN_EMPLOYEE_NO", "EMP-0001")

	databaseURL := getenv("DATABASE_URL", "postgres://hims:change-me@127.0.0.1:5432/hims?sslmode=disable")

	ctx := context.Background()
	st, err := store.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer st.Close()

	// License keys are seeded on every run so re-running with additional
	// SEED_LICENSE_KEYS values works even when the super admin already exists.
	seedLicenseKeys(ctx, st)

	if _, err := st.GetUserByLogin(ctx, username); err == nil {
		log.Printf("super admin %q already exists; skipping", username)
		return
	} else if err != store.ErrNotFound {
		log.Fatalf("lookup super admin: %v", err)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	id, err := st.CreateUserAccount(ctx, store.CreateUserParams{
		Username:           username,
		Email:              email,
		PasswordHash:       hash,
		Status:             domain.UserStatusActive,
		MustChangePassword: false,
		EmployeeNo:         employeeNo,
		FirstName:          "Super",
		LastName:           "Admin",
		JobTitle:           "Super Admin",
		RoleCodes:          []string{"super_admin"},
	})
	if err != nil {
		log.Fatalf("create super admin: %v", err)
	}
	log.Printf("created super admin %q (id=%s)", username, id)
}

// seedLicenseKeys inserts license keys from SEED_LICENSE_KEYS. The format is a
// comma-separated list of `key` or `key:label` entries, e.g.
//   SEED_LICENSE_KEYS='DH-ALPHA-1:Front desk,DH-ALPHA-2:Lab'
// Once at least one key exists, the desktop client requires a valid key to
// sign in (see POST /api/v1/auth/license).
func seedLicenseKeys(ctx context.Context, st *store.Store) {
	raw := os.Getenv("SEED_LICENSE_KEYS")
	if raw == "" {
		return
	}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		key, label := entry, ""
		if i := strings.Index(entry, ":"); i >= 0 {
			key = strings.TrimSpace(entry[:i])
			label = strings.TrimSpace(entry[i+1:])
		}
		if err := st.InsertLicense(ctx, key, label); err != nil {
			log.Fatalf("seed license key: %v", err)
		}
		log.Printf("seeded license key %q (label=%q)", key, label)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
