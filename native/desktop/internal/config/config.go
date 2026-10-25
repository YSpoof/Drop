package config

import (
	"flag"
	"os"
)

const (
	DefaultTargetURL = "https://drop.lzart.com.br"
	DefaultWidth     = 1024
	DefaultHeight    = 768
)

type Config struct {
	TargetURL string
	Width     int
	Height    int
	DevMode   bool
}

func Load() Config {
	urlFlag := flag.String("url", "", "Target URL to open in Chrome")
	widthFlag := flag.Int("width", DefaultWidth, "Initial window width")
	heightFlag := flag.Int("height", DefaultHeight, "Initial window height")
	devFlag := flag.Bool("dev", false, "Run in development mode")

	flag.Parse()

	targetURL := *urlFlag
	if targetURL == "" {
		if env := os.Getenv("DROP_URL"); env != "" {
			targetURL = env
		} else {
			targetURL = DefaultTargetURL
		}
	}

	return Config{
		TargetURL: targetURL,
		Width:     *widthFlag,
		Height:    *heightFlag,
		DevMode:   *devFlag,
	}
}
