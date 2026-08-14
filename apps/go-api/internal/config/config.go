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
	DatabaseURL       string
	SessionTTL        time.Duration
	PasswordResetTTL  time.Duration
	MFAIssuer         string
	MFAEncryptionKey  string
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
		DatabaseURL:       getenv("DATABASE_URL", "postgres://hims:change-me@127.0.0.1:5432/hims?sslmode=disable"),
		SessionTTL:        getenvDuration("SESSION_TTL", 8*time.Hour),
		PasswordResetTTL:  getenvDuration("PASSWORD_RESET_TTL", time.Hour),
		MFAIssuer:         getenv("MFA_ISSUER", "Divine Hands HMS"),
		MFAEncryptionKey:  getenv("MFA_ENCRYPTION_KEY", ""),
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

func getenvDuration(key string, def time.Duration) time.Duration {
	v := getenv(key, "")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
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
