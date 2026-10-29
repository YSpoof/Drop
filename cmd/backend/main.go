package main

import (
	"context"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"drop"
	"drop/internal/env"
	"drop/internal/httpx"
	"drop/internal/signaling"
)

func main() {
	port := env.Get("PORT", "4321")
	frontendDir := env.Get("FRONTEND_DIR", "")
	downloadsDir := env.Get("DOWNLOADS_DIR", "")

	hub := signaling.NewHub()

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", healthHandler)

	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := httpx.Upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("ws upgrade: %v", err)
			return
		}
		go hub.HandleConnection(conn)
	})

	// Downloads
	var downloadsFS fs.FS
	if downloadsDir != "" {
		downloadsFS = os.DirFS(downloadsDir)
	} else {
		sub, err := drop.DownloadsFS()
		if err != nil {
			log.Fatal(err)
		}
		downloadsFS = sub
	}
	mux.Handle("GET /downloads/", http.StripPrefix("/downloads/", http.FileServer(http.FS(downloadsFS))))

	// Frontend
	var frontendFS fs.FS
	if frontendDir != "" {
		frontendFS = os.DirFS(frontendDir)
	} else {
		sub, err := drop.FrontendFS()
		if err != nil {
			log.Fatal(err)
		}
		frontendFS = sub
	}
	mux.Handle("GET /", newFrontendHandler(frontendFS))

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		log.Printf("backend listening on :%s (sha=%s)", port, buildSHA)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
