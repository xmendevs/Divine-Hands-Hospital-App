package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/httpapi"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel,
	}))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer st.Close()

	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           httpapi.NewRouter(cfg, logger, st),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	logger.Info("service starting", "service", cfg.ServiceName, "addr", cfg.Addr())
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("service stopped with error", "error", err)
		os.Exit(1)
	}
}
