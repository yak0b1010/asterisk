.DEFAULT_GOAL := help
SHELL := /bin/bash

-include .env
export

# Compose project name (matches docker-compose.yaml `name:`)
COMPOSE ?= docker compose

.PHONY: help env up down logs ps build stack-up stack-down stack-logs stack-ps stack-build clean
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

# ── Full appliance stack (Postgres + Backend + Frontend) ──
stack-up: env ## Start the full appliance stack (postgres + backend + frontend)
	$(COMPOSE) up -d
	@echo "Stack up. Frontend: http://localhost:${FRONTEND_HOST_PORT:-8080}  Backend: http://localhost:${BACKEND_HOST_PORT:-5000}"

stack-down: ## Stop the full appliance stack
	$(COMPOSE) down

stack-logs: ## Follow the full appliance stack logs
	$(COMPOSE) logs -f

stack-ps: ## Show the full appliance stack containers
	$(COMPOSE) ps

stack-build: ## Build all appliance images
	$(COMPOSE) build

# alias for convenience
up: stack-up ## Start the full appliance stack
down: stack-down ## Stop the full appliance stack
logs: stack-logs ## Follow the full appliance stack logs
ps: stack-ps ## Show the full appliance stack containers
build: stack-build ## Build all appliance images

# ── Legacy PBX-only targets (Asterisk developer) ──
run: ## Apply firewall rules and start the PBX
	$(MAKE) -C asterisk run

test: ## Smoke-test the PBX
	$(MAKE) -C asterisk test

clean: ## Remove the PBX container, image and dev volumes
	$(MAKE) -C asterisk clean

.PHONY: asterisk-build asterisk-up asterisk-test
asterisk-build: ## Delegate image build to ./asterisk
	$(MAKE) -C asterisk build

asterisk-up: ## Run the PBX container alone
	$(MAKE) -C asterisk up

asterisk-test: ## Smoke-test the PBX container
	$(MAKE) -C asterisk test
