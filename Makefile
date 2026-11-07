.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE := docker compose

# Single source of truth for the full stack.
-include .env
export

.PHONY: help env up run down restart logs ps build pull test backend-test frontend-build cli firewall firewall-off firewall-status clean reset
.PHONY: asterisk-build asterisk-up asterisk-down asterisk-test

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

up: env ## Build and start the full stack (Postgres + backend + PBX + UI)
	$(COMPOSE) up -d --build

run: up ## Alias for 'up'

down: ## Stop the stack (database volume is kept)
	$(COMPOSE) down --remove-orphans

restart: ## Restart every service
	$(COMPOSE) restart

logs: ## Follow logs for all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show service state and health
	$(COMPOSE) ps

build: ## Build all images
	$(COMPOSE) build

pull: ## Pull the pinned PBX base image
	$(MAKE) -C asterisk pull

test: ## Validate Compose and run the backend test suite
	$(COMPOSE) config -q
	$(MAKE) backend-test

backend-test: ## Run backend tests (creates backend/.venv on first use)
	@test -x backend/.venv/bin/python || \
	  (cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt)
	cd backend && .venv/bin/python -m pytest -q

frontend-build: ## Type-check and build the React app
	cd frontend && npm ci && npm run build

cli: ## Open the Asterisk CLI of the running stack
	$(COMPOSE) exec asterisk asterisk -rvvv

firewall: ## Apply host firewall rules for the published PBX ports
	$(MAKE) -C asterisk firewall

firewall-off: ## Remove the host firewall rules created above
	$(MAKE) -C asterisk firewall-off

firewall-status: ## Show the host firewall state
	$(MAKE) -C asterisk firewall-status

clean: ## Stop the stack and delete its volumes (DESTRUCTIVE)
	$(COMPOSE) down --remove-orphans --volumes

reset: clean ## Alias for 'clean'

# ── PBX-only workflow (development without the backend) ──────────────────
asterisk-build: ## Build the PBX image alone
	$(MAKE) -C asterisk build

asterisk-up: ## Run the PBX container alone (no backend/dashboard)
	$(MAKE) -C asterisk up

asterisk-down: ## Stop the standalone PBX container
	$(MAKE) -C asterisk down

asterisk-test: ## Smoke-test the standalone PBX container
	$(MAKE) -C asterisk test
