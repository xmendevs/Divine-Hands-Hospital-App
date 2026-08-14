package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
)

type contextKey string

const requestIDKey contextKey = "requestID"

// ErrorBody is the standardized error detail. Kept consistent with the
// OpenAPI contract in packages/api-contracts.
type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

// ErrorEnvelope is the standardized error response format for every service.
type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	writeJSON(w, status, ErrorEnvelope{
		Error: ErrorBody{
			Code:      code,
			Message:   message,
			RequestID: requestIDFromContext(r.Context()),
		},
	})
}

// decodeJSON reads a JSON request body (max 1 MiB) into v.
func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(v)
}

func requestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey).(string); ok {
		return id
	}
	return ""
}

func newRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// clientIP returns the immediate peer address (X-Forwarded-For is not trusted).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
