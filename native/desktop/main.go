package main

import (
	"log"

	"dropnative/desktop/internal/config"
	"dropnative/desktop/internal/server"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	return server.Run(config.Load())
}
