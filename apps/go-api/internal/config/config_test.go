package config

import (
	"log/slog"
	"testing"
)

func TestParseLogLevel(t *testing.T) {
	cases := map[string]slog.Level{
		"debug": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"warn":  slog.LevelWarn,
		"error": slog.LevelError,
		"bogus": slog.LevelInfo,
	}
	for in, want := range cases {
		if got := parseLogLevel(in); got != want {
			t.Errorf("parseLogLevel(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestGetenvInt(t *testing.T) {
	t.Run("default", func(t *testing.T) {
		t.Setenv("X_PORT", "")
		if got := getenvInt("X_PORT", 5432); got != 5432 {
			t.Fatalf("got %d, want 5432", got)
		}
	})
	t.Run("valid", func(t *testing.T) {
		t.Setenv("X_PORT", "5555")
		if got := getenvInt("X_PORT", 5432); got != 5555 {
			t.Fatalf("got %d, want 5555", got)
		}
	})
	t.Run("invalid", func(t *testing.T) {
		t.Setenv("X_PORT", "nope")
		if got := getenvInt("X_PORT", 5432); got != 5432 {
			t.Fatalf("got %d, want 5432", got)
		}
	})
}
