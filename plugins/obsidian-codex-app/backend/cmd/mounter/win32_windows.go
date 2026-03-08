//go:build windows

package main

import (
	"errors"
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	procEnumWindows         = user32.NewProc("EnumWindows")
	procGetWindowThreadPID  = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procGetWindow           = user32.NewProc("GetWindow")
	procGetForegroundWindow = user32.NewProc("GetForegroundWindow")
	procSetParent           = user32.NewProc("SetParent")
	procGetWindowLongPtr    = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr    = user32.NewProc("SetWindowLongPtrW")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procShowWindow          = user32.NewProc("ShowWindow")
	procScreenToClient      = user32.NewProc("ScreenToClient")
)

const (
	gwOwner        = 4
	wsCaption      = 0x00C00000
	wsThickFrame   = 0x00040000
	wsMinimizeBox  = 0x00020000
	wsMaximizeBox  = 0x00010000
	wsSysMenu      = 0x00080000
	wsChild        = 0x40000000
	wsVisible      = 0x10000000
	swpNoZOrder    = 0x0004
	swpNoActivate  = 0x0010
	swpFrameChange = 0x0020
	swShow         = 5
)

const gwlStyle int32 = -16

type point struct {
	X int32
	Y int32
}

func waitForMainWindow(pid int, timeout time.Duration) (syscall.Handle, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if hwnd := findMainWindow(uint32(pid)); hwnd != 0 {
			return hwnd, nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	return 0, fmt.Errorf("timed out waiting for the Codex window after %s", timeout)
}

func findMainWindow(pid uint32) syscall.Handle {
	var result syscall.Handle
	callback := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		windowPID := uint32(0)
		procGetWindowThreadPID.Call(hwnd, uintptr(unsafe.Pointer(&windowPID)))
		if windowPID != pid {
			return 1
		}

		visible, _, _ := procIsWindowVisible.Call(hwnd)
		if visible == 0 {
			return 1
		}

		owner, _, _ := procGetWindow.Call(hwnd, gwOwner)
		if owner != 0 {
			return 1
		}

		result = syscall.Handle(hwnd)
		return 0
	})

	procEnumWindows.Call(callback, 0)
	return result
}

func getForegroundWindow() syscall.Handle {
	hwnd, _, _ := procGetForegroundWindow.Call()
	return syscall.Handle(hwnd)
}

func attachWindow(childHWND syscall.Handle, hostHWND syscall.Handle, bounds rectPayload) error {
	if childHWND == 0 || hostHWND == 0 {
		return errors.New("missing host or child window handle")
	}

	style, _, err := procGetWindowLongPtr.Call(uintptr(childHWND), signedInt32ToUintptr(gwlStyle))
	if style == 0 && err != syscall.Errno(0) {
		return err
	}

	newStyle := (style | wsChild | wsVisible) &^ (wsCaption | wsThickFrame | wsMinimizeBox | wsMaximizeBox | wsSysMenu)
	if _, _, err = procSetWindowLongPtr.Call(uintptr(childHWND), signedInt32ToUintptr(gwlStyle), newStyle); err != syscall.Errno(0) {
		return err
	}

	if ret, _, err := procSetParent.Call(uintptr(childHWND), uintptr(hostHWND)); ret == 0 && err != syscall.Errno(0) {
		return err
	}

	return moveAttachedWindow(childHWND, hostHWND, bounds)
}

func moveAttachedWindow(childHWND syscall.Handle, hostHWND syscall.Handle, bounds rectPayload) error {
	topLeft := point{X: int32(bounds.X), Y: int32(bounds.Y)}
	if ret, _, err := procScreenToClient.Call(uintptr(hostHWND), uintptr(unsafe.Pointer(&topLeft))); ret == 0 && err != syscall.Errno(0) {
		return err
	}

	if ret, _, err := procSetWindowPos.Call(
		uintptr(childHWND),
		0,
		uintptr(int(topLeft.X)),
		uintptr(int(topLeft.Y)),
		uintptr(bounds.Width),
		uintptr(bounds.Height),
		uintptr(swpNoZOrder|swpNoActivate|swpFrameChange),
	); ret == 0 && err != syscall.Errno(0) {
		return err
	}

	if ret, _, err := procShowWindow.Call(uintptr(childHWND), uintptr(swShow)); ret == 0 && err != syscall.Errno(0) {
		return err
	}

	return nil
}

func signedInt32ToUintptr(value int32) uintptr {
	return uintptr(int64(value))
}
