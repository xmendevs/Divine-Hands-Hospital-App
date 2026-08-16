package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type validateLicenseRequest struct {
	Key string `json:"key"`
}

// handleValidateLicense checks a license key presented by the desktop client.
//
// If no license keys are configured the server reports licensing as disabled
// and accepts any non-empty key, keeping existing deployments working. Once a
// hospital seeds license keys (e.g. via SEED_LICENSE_KEYS), only active keys
// are accepted and the desktop client cannot sign in without one.
func (s *server) handleValidateLicense(w http.ResponseWriter, r *http.Request) {
	var req validateLicenseRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Key == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "key is required")
		return
	}

	count, err := s.store.LicenseKeyCount(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if count == 0 {
		// Licensing disabled: accept the key so existing deployments are unaffected.
		writeJSON(w, http.StatusOK, map[string]any{"valid": true, "enforced": false})
		return
	}

	label, err := s.store.ValidateLicense(r.Context(), req.Key)
	if err != nil {
		if errors.Is(err, store.ErrLicenseNotFound) {
			s.recordSecurity(r, nil, domain.EventLicenseRejected, map[string]any{"reason": "invalid_license"})
			writeError(w, r, http.StatusUnauthorized, "invalid_license", "invalid or inactive license key")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	s.recordSecurity(r, nil, domain.EventLicenseAccepted, map[string]any{"label": label})
	writeJSON(w, http.StatusOK, map[string]any{"valid": true, "enforced": true, "label": label})
}

// licensePasses reports whether the request may proceed past the licensing
// gate. When no license keys are configured licensing is disabled and every
// request passes (keeping existing deployments working). Once at least one key
// exists, the request must present a valid active key in the X-License-Key
// header. A non-nil error means the check itself failed (caller should 500).
func (s *server) licensePasses(r *http.Request) (bool, error) {
	count, err := s.store.LicenseKeyCount(r.Context())
	if err != nil {
		return false, err
	}
	if count == 0 {
		return true, nil
	}
	key := r.Header.Get("X-License-Key")
	if key == "" {
		s.recordSecurity(r, nil, domain.EventLicenseRejected, map[string]any{"reason": "missing_license"})
		return false, nil
	}
	if _, err := s.store.ValidateLicense(r.Context(), key); err != nil {
		if errors.Is(err, store.ErrLicenseNotFound) {
			s.recordSecurity(r, nil, domain.EventLicenseRejected, map[string]any{"reason": "invalid_license"})
			return false, nil
		}
		return false, err
	}
	return true, nil
}
