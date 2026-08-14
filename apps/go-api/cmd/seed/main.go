package main

import (
	"context"
	"log"
	"os"

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

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
