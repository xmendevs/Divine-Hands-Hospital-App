package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

// health reports service liveness. Scaffold baseline only — real readiness
// probes (DB, Redis, S3) are added in later phases.
func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health)

	addr := ":" + port
	log.Printf("core service listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
