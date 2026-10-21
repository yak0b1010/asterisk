.DEFAULT_GOAL := help
SHELL := /bin/bash

-include .env
export

.PHONY: help env up run down logs ps build test clean
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

up: ## Start the PBX (full stack pending backend/dashboard)
	$(MAKE) -C asterisk up

run: ## Apply firewall rules and start the PBX
	$(MAKE) -C asterisk run

down: ## Stop the PBX
	$(MAKE) -C asterisk down

logs: ## Follow the PBX logs
	$(MAKE) -C asterisk logs

ps: ## Show the PBX container
	$(MAKE) -C asterisk ps

build: ## Build the PBX image
	$(MAKE) -C asterisk build

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
