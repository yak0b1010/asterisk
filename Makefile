.DEFAULT_GOAL := help
SHELL := /bin/bash

-include .env
export

.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: env
env: ## Create .env from .env.example if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

.PHONY: up down logs ps build
up: ## Build and start the full stack
	docker compose up -d --build

down: ## Stop the full stack
	docker compose down

logs: ## Follow the full stack logs
	docker compose logs -f

ps: ## Show the full stack status
	docker compose ps

build: ## Build the images
	docker compose build --pull

.PHONY: asterisk-build asterisk-up asterisk-test
asterisk-build: ## Delegate ASTERISK image build to ./asterisk
	$(MAKE) -C asterisk build

asterisk-up: ## Run the ASTERISK container alone
	$(MAKE) -C asterisk up

asterisk-test: ## Smoke-test the ASTERISK container
	$(MAKE) -C asterisk test
