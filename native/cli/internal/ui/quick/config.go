package quick

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"dropcli/internal/ports"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
)

// QuickConfig encapsulates command-line options for quick mode execution.
type QuickConfig struct {
	Quick        bool
	Host         bool
	ConnectPIN   string
	Paths        []string // raw positional args
	SendFiles    []string // validated regular files from Paths
	WatchDirs    []string // validated directories from Paths
	OutputDir    string
	AutoDownload bool
	ReceiveInbox bool // interactive session inbox UI (not used with -q)
}

// NewFlagSet builds and configures a FlagSet with standard DropCli flags.
func NewFlagSet(cfg *QuickConfig) *flag.FlagSet {
	fs := flag.NewFlagSet("dropcli", flag.ContinueOnError)

	fs.BoolVar(&cfg.Quick, "q", false, text.FlagQuick)
	fs.BoolVar(&cfg.Host, "s", false, text.FlagHost)
	fs.StringVar(&cfg.ConnectPIN, "c", "", text.FlagConnect)
	fs.StringVar(&cfg.OutputDir, "o", "", text.FlagOutput)

	fs.Usage = func() {
		out := fs.Output()
		fmt.Fprint(out, text.UsageHeader+"\n")
		fmt.Fprint(out, text.UsageSynopsis)
		fmt.Fprint(out, text.UsageInteractive)
		fmt.Fprint(out, text.UsageInteractiveEx)
		fmt.Fprint(out, text.UsageQuick)
		fmt.Fprint(out, text.UsageQuickHost)
		fmt.Fprint(out, text.UsageQuickJoin)
		fmt.Fprint(out, text.UsageFlags)
		fs.PrintDefaults()
	}

	return fs
}

// ParseArgs parses command line arguments into QuickConfig using standard flags.
func ParseArgs(args []string) (*QuickConfig, *flag.FlagSet, error) {
	cfg := &QuickConfig{AutoDownload: true}
	fs := NewFlagSet(cfg)
	if err := fs.Parse(args); err != nil {
		return nil, fs, err
	}
	cfg.Paths = fs.Args()
	return cfg, fs, nil
}

// Validate checks QuickConfig constraints.
func (c *QuickConfig) Validate() error {
	return c.ValidateWithRepo(nil)
}

// ValidateWithRepo checks QuickConfig constraints using the given repository for filesystem checks.
func (c *QuickConfig) ValidateWithRepo(repo ports.FileRepository) error {
	if len(c.Paths) > 0 {
		if err := c.classifyPaths(repo); err != nil {
			return err
		}
	}
	if !c.Quick {
		return nil
	}
	if !c.Host && c.ConnectPIN == "" {
		return errors.New(text.ErrQuickNeedsHostOrConnect)
	}
	if c.Host && c.ConnectPIN != "" {
		return errors.New(text.ErrHostAndConnect)
	}
	if c.ConnectPIN != "" {
		if err := tui.ValidatePIN(c.ConnectPIN); err != nil {
			return fmt.Errorf(text.ErrInvalidPIN, err)
		}
	}
	return nil
}

// classifyPaths splits Paths into SendFiles and WatchDirs. Rejects missing/invalid paths.
func (c *QuickConfig) classifyPaths(_ ports.FileRepository) error {
	c.SendFiles = nil
	c.WatchDirs = nil
	for _, p := range c.Paths {
		fi, err := os.Stat(p)
		if err != nil {
			return fmt.Errorf(text.ErrPathMissing, err)
		}
		switch {
		case fi.IsDir():
			c.WatchDirs = append(c.WatchDirs, p)
		case fi.Mode().IsRegular():
			c.SendFiles = append(c.SendFiles, p)
		default:
			return fmt.Errorf(text.ErrPathUnsupported, p)
		}
	}
	return nil
}
