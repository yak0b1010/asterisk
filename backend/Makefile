.DEFAULT_GOAL := help
SHELL := /bin/bash

PYTHON ?= python3
VENV ?= .venv
VENV_PY := $(VENV)/bin/python
VENV_PIP := $(VENV)/bin/pip
RUN_PY := $(if $(wildcard $(VENV_PY)),$(VENV_PY),$(PYTHON))
COMPOSE ?= docker compose

.PHONY: help env install run dev test compile smoke restore-test test-all \
        migrate db-up db-down db-logs docker-build docker-up docker-down docker-logs clean

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

env: ## Create backend/.env from .env.example if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

install: ## Create .venv and install runtime + test dependencies
	@test -x $(VENV_PY) || $(PYTHON) -m venv $(VENV)
	$(VENV_PIP) install --upgrade pip
	$(VENV_PIP) install -r requirements-dev.txt

run: ## Run the API using HTTP_ADDR from the environment
	$(RUN_PY) -m app

dev: ## Run the API with autoreload on 127.0.0.1:8080
	$(RUN_PY) -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8080

test: ## Run pytest (unit tests; integration tests need a running API)
	$(RUN_PY) -m pytest

compile: ## Byte-compile the application, scripts and tests
	$(RUN_PY) -m compileall -q app tools tests

smoke: ## Run the end-to-end smoke test against API_BASE_URL
	$(RUN_PY) tools/smoke_test.py

restore-test: ## Run the backup/restore + realtime test against API_BASE_URL
	$(RUN_PY) tools/restore_test.py

test-all: test smoke restore-test ## Run pytest, smoke and restore tests

migrate: ## Apply SQL migrations without starting the API
	$(RUN_PY) -c "from app.config import load_config; from app.database import build_engine, run_migrations; engine = build_engine(load_config()); run_migrations(engine); engine.dispose()"

db-up: ## Start only PostgreSQL (host port 5232 by default)
	$(COMPOSE) up -d postgres

db-down: ## Stop PostgreSQL
	$(COMPOSE) stop postgres

db-logs: ## Follow PostgreSQL logs
	$(COMPOSE) logs -f postgres

docker-build: ## Build the API image
	$(COMPOSE) build api

docker-up: ## Start PostgreSQL and the API with Docker Compose
	$(COMPOSE) up -d --build

docker-down: ## Stop the Compose stack
	$(COMPOSE) down

docker-logs: ## Follow API and PostgreSQL logs
	$(COMPOSE) logs -f

clean: ## Remove local Python caches
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .pytest_cache .coverage htmlcov
