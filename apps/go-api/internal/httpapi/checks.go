package httpapi

import (
	"context"
	"net"
	"strconv"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
)

// CheckResult is the outcome of a single readiness check.
type CheckResult struct {
	Status string `json:"status"`          // "ok" or "error"
	Error  string `json:"error,omitempty"` // set when status is "error"
}

// Checker performs a single dependency readiness check.
type Checker interface {
	Name() string
	Check(ctx context.Context) CheckResult
}

// tcpCheck verifies a TCP connection can be established to addr.
type tcpCheck struct {
	name string
	addr string
}

func (c tcpCheck) Name() string { return c.name }

func (c tcpCheck) Check(ctx context.Context) CheckResult {
	d := net.Dialer{Timeout: 2 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return CheckResult{Status: "error", Error: err.Error()}
	}
	_ = conn.Close()
	return CheckResult{Status: "ok"}
}

func defaultChecks(cfg config.Config) map[string]Checker {
	return map[string]Checker{
		"postgres": tcpCheck{
			name: "postgres",
			addr: net.JoinHostPort(cfg.PostgresHost, strconv.Itoa(cfg.PostgresPort)),
		},
		"redis": tcpCheck{
			name: "redis",
			addr: net.JoinHostPort(cfg.RedisHost, strconv.Itoa(cfg.RedisPort)),
		},
	}
}
