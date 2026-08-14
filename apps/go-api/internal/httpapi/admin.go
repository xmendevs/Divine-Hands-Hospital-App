package httpapi

import (
	"net/http"
	"strconv"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type createUserRequest struct {
	Username     string   `json:"username"`
	Email        string   `json:"email"`
	Password     string   `json:"password"`
	EmployeeNo   string   `json:"employeeNo"`
	FirstName    string   `json:"firstName"`
	LastName     string   `json:"lastName"`
	JobTitle     string   `json:"jobTitle"`
	DepartmentID string   `json:"departmentId"`
	RoleCodes    []string `json:"roleCodes"`
}

// handleCreateUser creates a staff account with roles.
func (s *server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Username == "" || req.Email == "" || req.Password == "" || req.EmployeeNo == "" || req.FirstName == "" || req.LastName == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "username, email, password, employeeNo, firstName, and lastName are required")
		return
	}
	if len(req.Password) < minPasswordLength {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "password must be at least 8 characters")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	actor := userFromContext(r.Context())
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	id, err := s.store.CreateUserAccount(r.Context(), store.CreateUserParams{
		Username:           req.Username,
		Email:              req.Email,
		PasswordHash:       hash,
		Status:             domain.UserStatusActive,
		MustChangePassword: true,
		EmployeeNo:         req.EmployeeNo,
		FirstName:          req.FirstName,
		LastName:           req.LastName,
		JobTitle:           req.JobTitle,
		DepartmentID:       deptID,
		RoleCodes:          req.RoleCodes,
		GrantedBy:          actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusConflict, "conflict", "username, email, or employee number already exists")
		return
	}
	s.recordAudit(r, domain.ActionUserCreate, "user", id, &id, map[string]any{"username": req.Username, "roles": req.RoleCodes})
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

type userRowResponse struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	Email      string `json:"email"`
	Status     string `json:"status"`
	FirstName  string `json:"firstName"`
	LastName   string `json:"lastName"`
	EmployeeNo string `json:"employeeNo"`
	CreatedAt  string `json:"createdAt"`
}

// handleListUsers lists all user accounts.
func (s *server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]userRowResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, userRowResponse{
			ID:         row.ID,
			Username:   row.Username,
			Email:      row.Email,
			Status:     string(row.Status),
			FirstName:  row.FirstName,
			LastName:   row.LastName,
			EmployeeNo: row.EmployeeNo,
			CreatedAt:  row.CreatedAt.UTC().Format(timeRFC3339),
		})
	}
	s.recordAudit(r, domain.ActionUsersViewed, "user", "", nil, nil)
	writeJSON(w, http.StatusOK, out)
}

type userDetailResponse struct {
	ID         string     `json:"id"`
	Username   string     `json:"username"`
	Email      string     `json:"email"`
	Status     string     `json:"status"`
	MFAEnabled bool       `json:"mfaEnabled"`
	Staff      any        `json:"staff"`
	Roles      []roleView `json:"roles"`
}

// handleGetUser returns a single user with staff profile and roles.
func (s *server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	u, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "user not found")
		return
	}
	staff, _ := s.store.GetStaffByUserID(r.Context(), u.ID)
	roles, _ := s.store.GetUserRoles(r.Context(), u.ID)
	resp := userDetailResponse{
		ID:         u.ID,
		Username:   u.Username,
		Email:      u.Email,
		Status:     string(u.Status),
		MFAEnabled: u.MFAEnabled,
		Staff:      staff,
		Roles:      make([]roleView, 0, len(roles)),
	}
	for _, rl := range roles {
		resp.Roles = append(resp.Roles, roleView{ID: rl.ID, Code: rl.Code, Name: rl.Name})
	}
	writeJSON(w, http.StatusOK, resp)
}

type updateUserRequest struct {
	Email        string `json:"email"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	JobTitle     string `json:"jobTitle"`
	DepartmentID string `json:"departmentId"`
}

// handleUpdateUser updates a user's email and staff profile.
func (s *server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req updateUserRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if _, err := s.store.GetUserByID(r.Context(), id); err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "user not found")
		return
	}
	if req.Email != "" {
		if err := s.store.UpdateUserEmail(r.Context(), id, req.Email); err != nil {
			writeError(w, r, http.StatusConflict, "conflict", "email already exists")
			return
		}
	}
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	if err := s.store.UpdateStaff(r.Context(), id, deptID, req.FirstName, req.LastName, req.JobTitle); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionUserUpdate, "user", id, &id, map[string]any{"email": req.Email})
	w.WriteHeader(http.StatusNoContent)
}

// handleSuspendUser suspends a user and revokes their sessions.
func (s *server) handleSuspendUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.SetUserStatus(r.Context(), id, domain.UserStatusSuspended); err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "user not found")
		return
	}
	_ = s.store.RevokeAllUserSessions(r.Context(), id)
	s.recordSecurity(r, &id, domain.EventAccountSuspended, nil)
	s.recordAudit(r, domain.ActionUserSuspend, "user", id, &id, nil)
	w.WriteHeader(http.StatusNoContent)
}

// handleActivateUser activates a suspended user.
func (s *server) handleActivateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.SetUserStatus(r.Context(), id, domain.UserStatusActive); err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "user not found")
		return
	}
	s.recordSecurity(r, &id, domain.EventAccountActivated, nil)
	s.recordAudit(r, domain.ActionUserActivate, "user", id, &id, nil)
	w.WriteHeader(http.StatusNoContent)
}

type assignRolesRequest struct {
	RoleCodes []string `json:"roleCodes"`
}

// handleAssignRoles replaces a user's roles.
func (s *server) handleAssignRoles(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req assignRolesRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.ReplaceUserRoles(r.Context(), id, req.RoleCodes, actor.ID); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionUserRolesAssigned, "user", id, &id, map[string]any{"roles": req.RoleCodes})
	w.WriteHeader(http.StatusNoContent)
}

// handleListRoles lists all roles.
func (s *server) handleListRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := s.store.ListRoles(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, roles)
}

type createRoleRequest struct {
	Code            string   `json:"code"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	MFARequired     bool     `json:"mfaRequired"`
	PermissionCodes []string `json:"permissionCodes"`
}

// handleCreateRole creates a role.
func (s *server) handleCreateRole(w http.ResponseWriter, r *http.Request) {
	var req createRoleRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code and name are required")
		return
	}
	id, err := s.store.CreateRole(r.Context(), req.Code, req.Name, req.Description, req.MFARequired, req.PermissionCodes)
	if err != nil {
		writeError(w, r, http.StatusConflict, "conflict", "role code already exists")
		return
	}
	s.recordAudit(r, domain.ActionRoleCreate, "role", id, nil, map[string]any{"code": req.Code, "permissions": req.PermissionCodes})
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

type updateRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	MFARequired bool   `json:"mfaRequired"`
}

// handleUpdateRole updates a role's metadata.
func (s *server) handleUpdateRole(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req updateRoleRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if err := s.store.UpdateRole(r.Context(), id, req.Name, req.Description, req.MFARequired); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionRoleUpdate, "role", id, nil, map[string]any{"name": req.Name, "mfaRequired": req.MFARequired})
	w.WriteHeader(http.StatusNoContent)
}

type setRolePermissionsRequest struct {
	PermissionCodes []string `json:"permissionCodes"`
}

// handleSetRolePermissions replaces a role's permissions.
func (s *server) handleSetRolePermissions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req setRolePermissionsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if err := s.store.SetRolePermissions(r.Context(), id, req.PermissionCodes); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionRolePermissionsSet, "role", id, nil, map[string]any{"permissions": req.PermissionCodes})
	w.WriteHeader(http.StatusNoContent)
}

// handleListPermissions lists all available permissions.
func (s *server) handleListPermissions(w http.ResponseWriter, r *http.Request) {
	perms, err := s.store.ListPermissions(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, perms)
}

// handleListDepartments lists departments.
func (s *server) handleListDepartments(w http.ResponseWriter, r *http.Request) {
	depts, err := s.store.ListDepartments(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, depts)
}

type createDepartmentRequest struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// handleCreateDepartment creates a department.
func (s *server) handleCreateDepartment(w http.ResponseWriter, r *http.Request) {
	var req createDepartmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code and name are required")
		return
	}
	id, err := s.store.CreateDepartment(r.Context(), req.Code, req.Name)
	if err != nil {
		writeError(w, r, http.StatusConflict, "conflict", "department code already exists")
		return
	}
	s.recordAudit(r, domain.ActionDepartmentCreate, "department", id, nil, map[string]any{"code": req.Code})
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// handleListAuditLogs lists audit entries.
func (s *server) handleListAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	logs, err := s.store.ListAuditLogs(r.Context(), limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionAuditViewed, "audit_log", "", nil, nil)
	writeJSON(w, http.StatusOK, logs)
}

// handleListSettings lists system settings.
func (s *server) handleListSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.ListSettings(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

type setSettingRequest struct {
	Value any `json:"value"`
}

// handleSetSetting upserts a system setting.
func (s *server) handleSetSetting(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	var req setSettingRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.SetSetting(r.Context(), key, req.Value, &actor.ID); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionSettingsUpdate, "setting", key, nil, map[string]any{"key": key})
	w.WriteHeader(http.StatusNoContent)
}

func pagination(r *http.Request) (limit, offset int) {
	limit = 100
	offset = 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

const timeRFC3339 = "2006-01-02T15:04:05Z07:00"
