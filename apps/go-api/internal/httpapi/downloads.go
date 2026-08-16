package httpapi

import (
	"fmt"
	"net/http"
	"os"
	"path"
)

// handleDownloadInstaller streams the Windows desktop installer to
// authenticated users. The binary itself is never committed to the repository;
// it is placed on the server (e.g. the main PC) and its path configured via
// APP_INSTALLER_PATH. Without it the endpoint returns 404, so downloads are
// only possible from a server that is hosting the file - and only for logged-in
// users with a valid session.
func (s *server) handleDownloadInstaller(w http.ResponseWriter, r *http.Request) {
	if s.cfg.InstallerPath == "" {
		writeError(w, r, http.StatusNotFound, "not_found", "installer not configured")
		return
	}
	f, err := os.Open(s.cfg.InstallerPath)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "installer not found")
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, path.Base(s.cfg.InstallerPath)))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", st.Size()))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, path.Base(s.cfg.InstallerPath), st.ModTime(), f)
}
