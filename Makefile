.DEFAULT_GOAL := help
SHELL := /bin/bash

# Single source of truth: the root .env.
-include .env
export

# Compose command. This is a tool override, not a configuration value.
COMPOSE ?= docker compose

# ── Environment validation ────────────────────────────────────────────────
# env and help bootstrap a clone before .env exists. Start and build goals
# require .env; full-stack start/build goals also require every value compose
# consumes so that compose never falls back to a built-in default.
ENV_GOALS    := stack-up up stack-build build run test clean asterisk-build asterisk-up asterisk-test
VALUE_GOALS  := stack-up up stack-build build
GOALS        := $(or $(MAKECMDGOALS),help)
CHECK_ENV    := $(filter $(ENV_GOALS),$(GOALS))
CHECK_VALUES := $(filter $(VALUE_GOALS),$(GOALS))

ifneq ($(CHECK_ENV),)
ifeq ($(wildcard .env),)
$(error .env is missing - run 'make env')
endif
endif

ifneq ($(CHECK_VALUES),)
REQUIRED_ENV := POSTGRES_VERSION DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD \
                POSTGRES_HOST_PORT BACKEND_HOST_PORT FRONTEND_HOST_PORT \
                JWT_SECRET_KEY JWT_ACCESS_TOKEN_EXPIRE_MINUTES CORS_ORIGINS
MISSING_ENV := $(strip $(foreach v,$(REQUIRED_ENV),$(if $(strip $($(v))),,$(v))))
ifneq ($(MISSING_ENV),)
$(error Missing or empty environment values: $(MISSING_ENV) - run 'make env' and edit .env)
endif
endif

.PHONY: help env up down logs ps build stack-up stack-down stack-logs stack-ps stack-build clean
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

# ── Full appliance stack (Postgres + Backend + Frontend) ──
stack-up: ## Start the full appliance stack (postgres + backend + frontend)
	$(COMPOSE) up -d
	@echo "Stack up. Frontend: http://localhost:$(FRONTEND_HOST_PORT)  Backend: http://localhost:$(BACKEND_HOST_PORT)"

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
