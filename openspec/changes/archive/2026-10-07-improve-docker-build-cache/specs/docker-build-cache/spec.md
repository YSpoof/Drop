# Spec Delta

## Purpose

Defines how the production Docker multi-stage image orders Go clients, Neutralino desktop packaging, and the web app build so expensive native layers stay cached when only web sources change.

## ADDED Requirements

### Requirement: Stage order is Go, then Neutralino shell, then web
The production Docker image build SHALL compile Go client artifacts (streamer extension and CLI) in a stage that runs before Neutralino desktop packaging. The web application build stage SHALL run after Neutralino packaging and SHALL consume the published desktop and CLI download artifacts from those earlier stages.

#### Scenario: Web-only change leaves Go stage cacheable
- **WHEN** a production Docker build runs after changes only under web application sources (for example `src/`) with unchanged Go module inputs
- **THEN** the Go client compile stage is eligible to hit Docker layer cache
- **AND** the web build stage still receives CLI binaries from that Go stage for `/downloads/`

#### Scenario: Native packaging follows Go streamer outputs
- **WHEN** the Neutralino desktop packaging stage runs
- **THEN** it packages using streamer binaries produced by the earlier Go stage (or an equivalent cached layer of that stage)
- **AND** it does not require recompiling streamer from source inside the Neutralino packaging commands themselves

### Requirement: Neutralino package stage ignores web-only invalidation
The Neutralino desktop packaging stage SHALL take build-context inputs limited to what the shell package needs (Neutralino config, package/lock metadata needed to run the package tooling, icons/resources required by that config, and the compiled streamer binaries from the Go stage). Changing only web application sources MUST NOT invalidate that packaging stage’s Docker layer cache.

#### Scenario: Web edit does not rebuild Neutralino package
- **WHEN** a production Docker build runs after changes only under web application sources with unchanged Neutralino packaging inputs and unchanged Go streamer outputs
- **THEN** the Neutralino packaging stage is eligible to hit Docker layer cache
- **AND** the web build stage still copies the cached desktop binaries into the published `/downloads/` paths

#### Scenario: Native input change rebuilds Neutralino package
- **WHEN** a production Docker build runs after a change to Neutralino packaging inputs (for example `neutralino.config.json` or package metadata used by the package scripts) or after Go streamer outputs change
- **THEN** the Neutralino packaging stage rebuilds
- **AND** the web build stage receives the newly packaged desktop binaries
