package config

import (
	"log/slog"
	"net"
	"os"
	"strconv"
	"time"
)

// Config holds runtime configuration sourced from environment variables with
// safe defaults for local development. Secrets are never embedded here.
type Config struct {
	ServiceName       string
	Host              string
	Port              int
	LogLevel          slog.Level
	Timezone          string
	PostgresHost      string
	PostgresPort      int
	RedisHost         string
	RedisPort         int
	ReadHeaderTimeout time.Duration
}

// Load reads configuration from the environment.
func Load() Config {
	return Config{
		ServiceName:       "go-api",
		Host:              getenv("HOST", "127.0.0.1"),
		Port:              getenvInt("PORT", 8080),
		LogLevel:          parseLogLevel(getenv("LOG_LEVEL", "info")),
		Timezone:          getenv("APP_TIMEZONE", "UTC"),
		PostgresHost:      getenv("POSTGRES_HOST", "127.0.0.1"),
		PostgresPort:      getenvInt("POSTGRES_PORT", 5432),
		RedisHost:         getenv("REDIS_HOST", "127.0.0.1"),
		RedisPort:         getenvInt("REDIS_PORT", 6379),
		ReadHeaderTimeout: 5 * time.Second,
	}
}

// Addr returns the host:port listen address.
func (c Config) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

func getenv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	v := getenv(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func parseLogLevel(v string) slog.Level {
	switch v {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
