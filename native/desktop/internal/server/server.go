package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"dropnative/desktop/internal/bridge"
	"dropnative/desktop/internal/chrome"
	"dropnative/desktop/internal/config"
	"dropnative/desktop/internal/streamer"
)

// Run starts the loopback server, launches Chrome, and supervises the desktop session.
func Run(cfg config.Config) error {
	token, err := streamer.NewToken()
	if err != nil {
		return fmt.Errorf("create token: %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("bind loopback listener: %w", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	bridgeServer := bridge.NewServer(token)
	mux.Handle("/bridge", bridgeServer)
	streamer.RegisterRoutes(mux, token)

	srv := &http.Server{
		Handler:           streamer.CORSMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		if err := srv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	// Build target URL with dropPort and dropToken
	launchURL, err := buildLaunchURL(cfg.TargetURL, port, token)
	if err != nil {
		_ = srv.Close()
		return fmt.Errorf("build launch url: %w", err)
	}

	profileDir, err := chrome.PersistentProfileDir()
	if err != nil {
		_ = srv.Close()
		return fmt.Errorf("prepare Chrome profile: %w", err)
	}

	log.Printf("Drop desktop host listening on 127.0.0.1:%d", port)
	log.Printf("Launching Chrome pointing to %s", launchURL)

	cmd, err := chrome.Command(launchURL, profileDir, cfg.Width, cfg.Height)
	if err != nil {
		_ = srv.Close()
		return fmt.Errorf("prepare chrome command: %w", err)
	}

	if err := cmd.Start(); err != nil {
		_ = srv.Close()
		return fmt.Errorf("start chrome: %w", err)
	}

	chromeErr := cmd.Wait()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)

	select {
	case err := <-serverErr:
		return fmt.Errorf("server error: %w", err)
	default:
	}

	if chromeErr != nil {
		return fmt.Errorf("chrome exited with error: %w", chromeErr)
	}

	return nil
}

func buildLaunchURL(rawURL string, port int, token string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("dropPort", strconv.Itoa(port))
	q.Set("dropToken", token)
	u.RawQuery = q.Encode()
	return u.String(), nil
}
