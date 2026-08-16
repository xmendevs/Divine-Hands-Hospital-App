package httpapi

import (
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

const minPasswordLength = 8

type loginRequest struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	TotpCode   string `json:"totpCode"`
	DeviceName string `json:"deviceName"`
}

type userResponse struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Status   string `json:"status"`
}

type loginResponse struct {
	Token              string       `json:"token"`
	ExpiresAt          time.Time    `json:"expiresAt"`
	MustChangePassword bool         `json:"mustChangePassword"`
	User               userResponse `json:"user"`
}

// handleLogin authenticates a user and issues a session token.
func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "username and password are required")
		return
	}

	// Licensing gate: once keys are configured, a valid key must accompany
	// every login attempt so the desktop app cannot be used without one.
	if ok, lerr := s.licensePasses(r); lerr != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	} else if !ok {
		writeError(w, r, http.StatusUnauthorized, "license_required", "a valid license key is required to sign in")
		return
	}

	u, err := s.store.GetUserByLogin(r.Context(), req.Username)
	if err != nil {
		s.recordSecurity(r, nil, domain.EventLoginFailure, map[string]any{"username": req.Username, "reason": "invalid_credentials"})
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}

	if u.Status == domain.UserStatusSuspended {
		s.recordSecurity(r, &u.ID, domain.EventAccountSuspended, map[string]any{"reason": "login_attempt"})
		writeError(w, r, http.StatusForbidden, "forbidden", "account suspended")
		return
	}

	ok, err := auth.VerifyPassword(u.PasswordHash, req.Password)
	if err != nil || !ok {
		s.recordSecurity(r, &u.ID, domain.EventLoginFailure, map[string]any{"reason": "invalid_password"})
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}

	mfaRequired, err := s.store.UserHasPrivilegedRole(r.Context(), u.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if mfaRequired || u.MFAEnabled {
		if !s.verifyMFA(u, req.TotpCode) {
			s.recordSecurity(r, &u.ID, domain.EventMFAVerificationFailed, nil)
			writeError(w, r, http.StatusUnauthorized, "mfa_required", "valid MFA code required")
			return
		}
	}

	raw, hash, err := auth.GenerateToken()
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	expires := time.Now().Add(s.cfg.SessionTTL)
	sessionID, err := s.store.CreateSession(r.Context(), u.ID, hash, clientIP(r), r.UserAgent(), req.DeviceName, expires)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	_ = s.store.UpdateLastLogin(r.Context(), u.ID)
	s.recordSecurity(r, &u.ID, domain.EventLoginSuccess, map[string]any{"session_id": sessionID})

	writeJSON(w, http.StatusOK, loginResponse{
		Token:              raw,
		ExpiresAt:          expires,
		MustChangePassword: u.MustChangePassword,
		User:               userResponse{ID: u.ID, Username: u.Username, Email: u.Email, Status: string(u.Status)},
	})
}

// verifyMFA decrypts the stored secret and validates the TOTP code.
func (s *server) verifyMFA(u *domain.User, code string) bool {
	if u.MFASecretEncrypted == nil || s.mfaCipher == nil || code == "" {
		return false
	}
	secret, err := s.mfaCipher.Decrypt(u.MFASecretEncrypted)
	if err != nil {
		return false
	}
	return auth.VerifyTOTP(string(secret), code)
}

// handleLogout revokes the current session.
func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	sess := sessionFromContext(r.Context())
	_ = s.store.RevokeSession(r.Context(), sess.ID)
	s.recordSecurity(r, &u.ID, domain.EventLogout, nil)
	w.WriteHeader(http.StatusNoContent)
}

type meResponse struct {
	ID                 string     `json:"id"`
	Username           string     `json:"username"`
	Email              string     `json:"email"`
	Status             string     `json:"status"`
	MustChangePassword bool       `json:"mustChangePassword"`
	MFAEnabled         bool       `json:"mfaEnabled"`
	Staff              any        `json:"staff"`
	Roles              []roleView `json:"roles"`
	Permissions        []string   `json:"permissions"`
}

type roleView struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// handleMe returns the authenticated user's profile, roles, and permissions.
func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	roles, _ := s.store.GetUserRoles(r.Context(), u.ID)
	perms, _ := s.store.GetUserPermissions(r.Context(), u.ID)
	staff, _ := s.store.GetStaffByUserID(r.Context(), u.ID)

	resp := meResponse{
		ID:                 u.ID,
		Username:           u.Username,
		Email:              u.Email,
		Status:             string(u.Status),
		MustChangePassword: u.MustChangePassword,
		MFAEnabled:         u.MFAEnabled,
		Staff:              staff,
		Roles:              make([]roleView, 0, len(roles)),
		Permissions:        perms,
	}
	for _, r := range roles {
		resp.Roles = append(resp.Roles, roleView{ID: r.ID, Code: r.Code, Name: r.Name})
	}
	writeJSON(w, http.StatusOK, resp)
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// handleChangePassword updates the authenticated user's password.
func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if len(req.NewPassword) < minPasswordLength {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "new password must be at least 8 characters")
		return
	}
	u := userFromContext(r.Context())
	sess := sessionFromContext(r.Context())

	ok, err := auth.VerifyPassword(u.PasswordHash, req.CurrentPassword)
	if err != nil || !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "current password is incorrect")
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if err := s.store.SetUserPassword(r.Context(), u.ID, hash); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.RevokeUserSessionsExcept(r.Context(), u.ID, sess.ID)
	s.recordSecurity(r, &u.ID, domain.EventPasswordChanged, nil)
	s.recordAudit(r, domain.ActionUserPasswordChanged, "user", u.ID, &u.ID, nil)
	w.WriteHeader(http.StatusNoContent)
}

// handleMFASetup generates and stores (unconfirmed) a TOTP secret.
func (s *server) handleMFASetup(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	if u.MFAEnabled {
		writeError(w, r, http.StatusConflict, "conflict", "MFA is already enabled")
		return
	}
	if s.mfaCipher == nil {
		writeError(w, r, http.StatusServiceUnavailable, "unavailable", "MFA encryption key is not configured")
		return
	}
	secret, otpauthURL, err := auth.GenerateTOTP(s.cfg.MFAIssuer, u.Username)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	enc, err := s.mfaCipher.Encrypt([]byte(secret))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if err := s.store.SetUserMFA(r.Context(), u.ID, enc, false); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"secret": secret, "otpauthUrl": otpauthURL})
}

type mfaConfirmRequest struct {
	Code string `json:"code"`
}

// handleMFAConfirm verifies a TOTP code and enables MFA.
func (s *server) handleMFAConfirm(w http.ResponseWriter, r *http.Request) {
	var req mfaConfirmRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	u := userFromContext(r.Context())
	if !s.verifyMFA(u, req.Code) {
		s.recordSecurity(r, &u.ID, domain.EventMFAVerificationFailed, nil)
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "invalid MFA code")
		return
	}
	if err := s.store.SetUserMFA(r.Context(), u.ID, u.MFASecretEncrypted, true); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordSecurity(r, &u.ID, domain.EventMFAEnrolled, nil)
	s.recordAudit(r, domain.ActionUserMFAEnabled, "user", u.ID, &u.ID, nil)
	w.WriteHeader(http.StatusNoContent)
}

type passwordResetRequest struct {
	Username string `json:"username"`
}

// handlePasswordResetRequest issues a reset token (delivery is a later phase;
// the token is stored hashed and never returned).
func (s *server) handlePasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	var req passwordResetRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Username == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "username is required")
		return
	}
	u, err := s.store.GetUserByLogin(r.Context(), req.Username)
	if err == nil {
		raw, hash, gerr := auth.GenerateToken()
		if gerr == nil {
			_ = s.store.CreatePasswordResetToken(r.Context(), u.ID, hash, time.Now().Add(s.cfg.PasswordResetTTL))
			_ = raw // delivery via email is implemented in a later phase
		}
		s.recordSecurity(r, &u.ID, domain.EventPasswordResetRequested, nil)
	}
	// Always return the same response to avoid account enumeration.
	writeJSON(w, http.StatusAccepted, map[string]string{
		"message": "if the account exists, a password reset has been issued",
	})
}

type passwordResetConfirmRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

// handlePasswordResetConfirm completes a password reset with a valid token.
func (s *server) handlePasswordResetConfirm(w http.ResponseWriter, r *http.Request) {
	var req passwordResetConfirmRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if len(req.NewPassword) < minPasswordLength {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "new password must be at least 8 characters")
		return
	}
	tok, err := s.store.GetPasswordResetToken(r.Context(), auth.HashToken(req.Token))
	if err != nil || tok.UsedAt != nil || time.Now().After(tok.ExpiresAt) {
		writeError(w, r, http.StatusBadRequest, "invalid_token", "invalid or expired reset token")
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if err := s.store.SetUserPassword(r.Context(), tok.UserID, hash); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.MarkPasswordResetUsed(r.Context(), tok.ID)
	_ = s.store.RevokeAllUserSessions(r.Context(), tok.UserID)
	s.recordSecurity(r, &tok.UserID, domain.EventPasswordResetCompleted, nil)
	s.recordAudit(r, domain.ActionUserPasswordReset, "user", tok.UserID, &tok.UserID, nil)
	w.WriteHeader(http.StatusNoContent)
}
