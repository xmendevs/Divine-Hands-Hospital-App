package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/golang-migrate/migrate/v4"
	migratepgx "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
)

func main() {
	var dir, command string
	flag.StringVar(&dir, "dir", migrationsDir(), "path to the migrations directory")
	flag.StringVar(&command, "command", "", "one of: up, down, version")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://hims:change-me@127.0.0.1:5432/hims?sslmode=disable"
	}

	pgxCfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		log.Fatalf("invalid DATABASE_URL: %v", err)
	}

	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer sqlDB.Close()

	driver, err := migratepgx.WithInstance(sqlDB, &migratepgx.Config{
		DatabaseName: pgxCfg.Database,
		SchemaName:   "public",
	})
	if err != nil {
		log.Fatalf("migrate driver: %v", err)
	}
	src, err := iofs.New(os.DirFS(dir), ".")
	if err != nil {
		log.Fatalf("migrations source: %v", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx", driver)
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}

	switch command {
	case "up":
		err = m.Up()
	case "down":
		err = m.Steps(-1)
	case "version":
		version, dirty, verr := m.Version()
		if verr != nil && !errors.Is(verr, migrate.ErrNilVersion) {
			log.Fatalf("version: %v", verr)
		}
		fmt.Printf("version=%d dirty=%v\n", version, dirty)
		return
	default:
		fmt.Println("usage: migrate -command up|down|version [-dir DIR]")
		os.Exit(2)
	}

	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		log.Fatalf("migration %s failed: %v", command, err)
	}
	fmt.Printf("migration %s complete\n", command)
}

func migrationsDir() string {
	if v := os.Getenv("MIGRATIONS_DIR"); v != "" {
		return v
	}
	return "../../db/migrations"
}
