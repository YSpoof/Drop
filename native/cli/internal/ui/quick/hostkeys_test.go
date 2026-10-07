package quick

import (
	"os"
	"testing"
)

func TestHostCopyKeysDisabledOnNonTTY(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()

	if hostCopyKeysEnabled(r) {
		t.Fatal("expected non-TTY pipe to disable host copy keys")
	}
}
