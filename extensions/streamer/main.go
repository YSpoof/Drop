package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

const tokenHeader = "X-Drop-Token"

type bootstrap struct {
	port         int
	token        string
	connectToken string
	extensionID  string
}

type inbound struct {
	Event string `json:"event"`
}

func main() {
	boot, err := readBootstrap()
	if err != nil {
		fmt.Fprintf(os.Stderr, "streamer bootstrap: %v\n", err)
		os.Exit(1)
	}

	fileToken, err := newToken()
	if err != nil {
		os.Exit(1)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	httpPort := listener.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/read", handleRead)
	mux.HandleFunc("/write", handleWrite)
	go func() {
		err := http.Serve(listener, corsMiddleware(authMiddleware(fileToken, mux)))
		if err != nil {
			fmt.Fprintf(os.Stderr, "streamer: %v\n", err)
		}
	}()

	conn, err := dialExtension(boot.port, boot.extensionID, boot.connectToken)
	if err != nil {
		fmt.Fprintf(os.Stderr, "streamer connect: %v\n", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "streamerReady port=%d\n", httpPort)

	if err = broadcastReady(conn, boot.token, httpPort, fileToken); err != nil {
		fmt.Fprintf(os.Stderr, "streamer ready: %v\n", err)
		os.Exit(1)
	}

	for {
		payload, err := conn.readText()
		if err != nil {
			os.Exit(0)
		}
		var msg inbound
		if json.Unmarshal(payload, &msg) != nil {
			continue
		}
		switch msg.Event {
		case "windowClose":
			os.Exit(0)
		case "streamerAck":
			if err = broadcastReady(conn, boot.token, httpPort, fileToken); err != nil {
				os.Exit(0)
			}
		}
	}
}

func readBootstrap() (bootstrap, error) {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		return bootstrap{}, err
	}
	var msg struct {
		NLPort         json.RawMessage `json:"nlPort"`
		NLToken        string          `json:"nlToken"`
		NLConnectToken string          `json:"nlConnectToken"`
		NLExtensionID  string          `json:"nlExtensionId"`
	}
	if err = json.Unmarshal(raw, &msg); err != nil {
		return bootstrap{}, err
	}
	port, err := parsePort(msg.NLPort)
	if err != nil {
		return bootstrap{}, err
	}
	if msg.NLToken == "" || msg.NLConnectToken == "" || msg.NLExtensionID == "" {
		return bootstrap{}, fmt.Errorf("incomplete bootstrap")
	}
	return bootstrap{
		port:         port,
		token:        msg.NLToken,
		connectToken: msg.NLConnectToken,
		extensionID:  msg.NLExtensionID,
	}, nil
}

func parsePort(raw json.RawMessage) (int, error) {
	var port int
	if err := json.Unmarshal(raw, &port); err == nil {
		return port, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, err
	}
	return strconv.Atoi(text)
}

func broadcastReady(conn *wsConn, accessToken string, httpPort int, fileToken string) error {
	msg := map[string]any{
		"id":          fmt.Sprintf("go-ext-%d", time.Now().UnixNano()),
		"method":      "app.broadcast",
		"accessToken": accessToken,
		"data": map[string]any{
			"event": "streamerReady",
			"data":  map[string]any{"port": httpPort, "token": fileToken},
		},
	}
	bytes, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return conn.writeText(bytes)
}

func newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func handleRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, path)
}

func handleWrite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Missing path", http.StatusBadRequest)
		return
	}

	flag := os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	if r.URL.Query().Get("append") == "1" {
		flag = os.O_WRONLY | os.O_CREATE | os.O_APPEND
	}
	file, err := os.OpenFile(path, flag, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "streamer write: %v\n", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer file.Close()

	if _, err = io.Copy(file, r.Body); err != nil {
		fmt.Fprintf(os.Stderr, "streamer write: %v\n", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func authMiddleware(token string, next http.Handler) http.Handler {
	tokenBytes := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get(tokenHeader))
		if len(got) != len(tokenBytes) || subtle.ConstantTimeCompare(got, tokenBytes) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "X-Drop-Token, Range, Content-Type")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
