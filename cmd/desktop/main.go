package main

import (
	"log"

	"drop/internal/desktop/config"
	"drop/internal/desktop/server"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	return server.Run(config.Load())
}
