package main

import (
	"log/slog"
	"net/http"
	"os"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/httpapi"
)

func main() {
	cfg := config.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel,
	}))

	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           httpapi.NewRouter(cfg, logger),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
	}

	logger.Info("service starting", "service", cfg.ServiceName, "addr", cfg.Addr())
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("service stopped with error", "error", err)
		os.Exit(1)
	}
}
