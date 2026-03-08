package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

const version = "0.1.0"

type readyMessage struct {
	Ready   bool   `json:"ready"`
	Port    int    `json:"port"`
	Version string `json:"version"`
}

type healthResponse struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
}

type statusResponse struct {
	State     string `json:"state"`
	PID       int    `json:"pid"`
	Mounted   bool   `json:"mounted"`
	LastError string `json:"lastError,omitempty"`
}

type rectPayload struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type mountRequest struct {
	ExecutablePath string      `json:"executablePath"`
	LaunchArgs     []string    `json:"launchArgs"`
	Bounds         rectPayload `json:"bounds"`
	AttachTimeout  int         `json:"attachTimeoutMs"`
}

type boundsRequest struct {
	Bounds rectPayload `json:"bounds"`
}

type service struct {
	mu        sync.Mutex
	state     string
	lastError string
	cmd       *exec.Cmd
	childHWND syscall.Handle
	hostHWND  syscall.Handle
	pid       int
	server    *http.Server
}

func main() {
	svc := &service{state: "ready"}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", svc.handleHealth)
	mux.HandleFunc("/status", svc.handleStatus)
	mux.HandleFunc("/mount", svc.handleMount)
	mux.HandleFunc("/bounds", svc.handleBounds)
	mux.HandleFunc("/unmount", svc.handleUnmount)
	mux.HandleFunc("/shutdown", svc.handleShutdown)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}

	svc.server = &http.Server{Handler: mux}

	port := listener.Addr().(*net.TCPAddr).Port
	encoded, err := json.Marshal(readyMessage{
		Ready:   true,
		Port:    port,
		Version: version,
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(string(encoded))

	if err := svc.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func (s *service) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{OK: true, Version: version})
}

func (s *service) handleStatus(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()

	writeJSON(w, http.StatusOK, statusResponse{
		State:     s.state,
		PID:       s.pid,
		Mounted:   s.childHWND != 0 && s.pid > 0,
		LastError: s.lastError,
	})
}

func (s *service) handleMount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req mountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.ExecutablePath == "" {
		http.Error(w, "executablePath is required", http.StatusBadRequest)
		return
	}

	if req.Bounds.Width <= 0 || req.Bounds.Height <= 0 {
		http.Error(w, "bounds must be positive", http.StatusBadRequest)
		return
	}

	if req.AttachTimeout <= 0 {
		req.AttachTimeout = 15000
	}

	if err := s.mount(req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"pid":     s.pid,
		"mounted": true,
	})
}

func (s *service) handleBounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req boundsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := s.updateBounds(req.Bounds); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *service) handleUnmount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := s.unmount(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *service) handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	_ = s.unmount()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.server.Shutdown(ctx)
	}()
}

func (s *service) mount(req mountRequest) error {
	s.mu.Lock()
	if s.cmd != nil {
		s.mu.Unlock()
		return errors.New("Codex is already mounted")
	}
	s.state = "mounting"
	s.lastError = ""
	s.mu.Unlock()

	cmd := exec.Command(req.ExecutablePath, req.LaunchArgs...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	if err := cmd.Start(); err != nil {
		s.setError(fmt.Sprintf("failed to start Codex: %v", err))
		return err
	}

	pid := cmd.Process.Pid
	timeout := time.Duration(req.AttachTimeout) * time.Millisecond
	childHWND, err := waitForMainWindow(pid, timeout)
	if err != nil {
		_ = terminateProcess(cmd.Process)
		s.setError(err.Error())
		return err
	}

	hostHWND := getForegroundWindow()
	if hostHWND == 0 {
		_ = terminateProcess(cmd.Process)
		s.setError("could not find the foreground Obsidian window")
		return errors.New("could not find the foreground Obsidian window")
	}

	if err := attachWindow(childHWND, hostHWND, req.Bounds); err != nil {
		_ = terminateProcess(cmd.Process)
		s.setError(err.Error())
		return err
	}

	s.mu.Lock()
	s.cmd = cmd
	s.pid = pid
	s.childHWND = childHWND
	s.hostHWND = hostHWND
	s.state = "mounted"
	s.lastError = ""
	s.mu.Unlock()

	go s.waitForExit(cmd)
	return nil
}

func (s *service) updateBounds(bounds rectPayload) error {
	s.mu.Lock()
	childHWND := s.childHWND
	hostHWND := s.hostHWND
	s.mu.Unlock()

	if childHWND == 0 || hostHWND == 0 {
		return nil
	}

	return moveAttachedWindow(childHWND, hostHWND, bounds)
}

func (s *service) unmount() error {
	s.mu.Lock()
	cmd := s.cmd
	s.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		s.mu.Lock()
		s.state = "ready"
		s.lastError = ""
		s.pid = 0
		s.childHWND = 0
		s.hostHWND = 0
		s.cmd = nil
		s.mu.Unlock()
		return nil
	}

	err := terminateProcess(cmd.Process)
	s.mu.Lock()
	s.state = "ready"
	s.lastError = ""
	s.pid = 0
	s.childHWND = 0
	s.hostHWND = 0
	s.cmd = nil
	s.mu.Unlock()
	return err
}

func (s *service) waitForExit(cmd *exec.Cmd) {
	_ = cmd.Wait()

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cmd == cmd {
		s.cmd = nil
		s.pid = 0
		s.childHWND = 0
		s.hostHWND = 0
		if s.state != "ready" {
			s.state = "ready"
		}
	}
}

func (s *service) setError(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = "error"
	s.lastError = strings.TrimSpace(message)
	s.cmd = nil
	s.pid = 0
	s.childHWND = 0
	s.hostHWND = 0
}

func terminateProcess(process *os.Process) error {
	if process == nil {
		return nil
	}

	if err := process.Kill(); err != nil && !strings.Contains(err.Error(), "already finished") {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
