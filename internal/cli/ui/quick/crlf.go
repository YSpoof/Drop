package quick

import (
	"fmt"
	"io"
	"strings"
	"sync/atomic"
)

// hostRawActive is true while hostCopyKeys holds stdin in raw mode (MakeRaw).
// While set, host-wait status lines must use CRLF so the cursor returns to column 0.
var hostRawActive atomic.Bool

func setHostRawActive(v bool) {
	hostRawActive.Store(v)
}

func hostRawIsActive() bool {
	return hostRawActive.Load()
}

// toCRLF converts bare newlines to CRLF without doubling existing CR+LF pairs.
func toCRLF(s string) string {
	if !strings.Contains(s, "\n") {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' && (i == 0 || s[i-1] != '\r') {
			b.WriteByte('\r')
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// crlfIfRaw returns s unchanged when raw mode is inactive; otherwise applies toCRLF.
func crlfIfRaw(s string) string {
	if !hostRawIsActive() {
		return s
	}
	return toCRLF(s)
}

// writeHostWait writes s to w, applying CRLF conversion only while host raw mode is active.
func writeHostWait(w io.Writer, s string) (int, error) {
	return io.WriteString(w, crlfIfRaw(s))
}

// fprintfHostWait formats and writes via writeHostWait.
func fprintfHostWait(w io.Writer, format string, args ...any) (int, error) {
	return writeHostWait(w, fmt.Sprintf(format, args...))
}
