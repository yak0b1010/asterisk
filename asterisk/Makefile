# asterisk/Makefile
#
# Scope: this directory only. Builds and runs the PBX container in isolation.
# The repository-root Makefile delegates here until backend/dashboard exist.
#
# Lifecycle is idempotent:
#   up        running -> no-op, stopped -> start, missing -> create
#   down      running -> stop, otherwise no-op
#   restart   existing -> docker restart, missing -> create
#   recreate  remove + create (applies new image/config; volumes kept)
#   rebuild   build + recreate

SHELL := /bin/bash
.DEFAULT_GOAL := help

HERE     := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
HERE_ABS := $(abspath $(HERE))
ROOT_ABS := $(abspath $(HERE)/..)
ENV_FILE ?= $(ROOT_ABS)/.env

ifeq ($(wildcard $(ENV_FILE)),)
$(warning $(ENV_FILE) missing - run 'make env')
endif

# Single source of truth: the root .env
-include $(ENV_FILE)
export

# ── Values from .env (strip: inline comments leave trailing space) ─────────
IMAGE_NAME := $(strip $(ASTERISK_IMAGE))
IMAGE_TAG  := $(strip $(ASTERISK_TAG))
DIGEST     := $(strip $(ASTERISK_DIGEST))
MODE       := $(if $(strip $(ASTERISK_MODE)),$(strip $(ASTERISK_MODE)),standalone)
APP_IMAGE  := $(if $(strip $(ASTERISK_APP_IMAGE)),$(strip $(ASTERISK_APP_IMAGE)),asterisk-appliance)

ifeq ($(IMAGE_NAME),)
$(error ASTERISK_IMAGE is not set - run 'make env' and edit .env)
endif
ifeq ($(IMAGE_TAG),)
$(error ASTERISK_TAG is not set - see .env.example)
endif

BASE_REF   := $(IMAGE_NAME):$(IMAGE_TAG)$(if $(DIGEST),@$(DIGEST))
APP_TAG    := $(MODE)
CONTAINER  := asterisk-$(MODE)

SIP_PORT       := $(if $(strip $(SIP_PORT)),$(strip $(SIP_PORT)),5060)
RTP_RANGE      := $(if $(strip $(RTP_RANGE)),$(strip $(RTP_RANGE)),10000-10199)
HTTP_PORT      := $(if $(strip $(HTTP_PORT)),$(strip $(HTTP_PORT)),8088)
WSS_PORT       := $(if $(strip $(WSS_PORT)),$(strip $(WSS_PORT)),8089)
DASHBOARD_PORT := $(if $(strip $(DASHBOARD_PORT)),$(strip $(DASHBOARD_PORT)),8080)

# PBX_FQDN is preferred; TLS_COMMON_NAME keeps older .env files working.
FQDN := $(strip $(or $(PBX_FQDN),$(TLS_COMMON_NAME),asterisk.local))

FIREWALL_ENABLED := $(if $(strip $(FIREWALL_ENABLED)),$(strip $(FIREWALL_ENABLED)),yes)
FIREWALL_MODE    := $(if $(strip $(FIREWALL_MODE)),$(strip $(FIREWALL_MODE)),permanent)
FIREWALL_SCRIPT  := $(HERE_ABS)/conf/scripts/firewall.sh

VOL_LIB       := asterisk-$(MODE)-lib
VOL_SPOOL     := asterisk-$(MODE)-spool
VOL_LOG       := asterisk-$(MODE)-log
VOL_KEYS      := asterisk-$(MODE)-keys
VOL_SOUNDS    := asterisk-$(MODE)-sounds
VOL_PHONEPROV := asterisk-$(MODE)-phoneprov

ENV_FLAG := $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)

DOCKER_RUN := docker run -d --name $(CONTAINER) --restart unless-stopped \
  --network host \
  --hostname $(FQDN) \
  --add-host $(FQDN):127.0.1.1 \
  $(ENV_FLAG) \
  --env RTP_RANGE=$(RTP_RANGE) \
  --mount type=volume,source=$(VOL_LIB),target=/var/lib/asterisk \
  --mount type=volume,source=$(VOL_KEYS),target=/var/lib/asterisk/keys \
  --mount type=volume,source=$(VOL_SOUNDS),target=/var/lib/asterisk/sounds \
  --mount type=volume,source=$(VOL_PHONEPROV),target=/var/lib/asterisk/phoneprov \
  --mount type=volume,source=$(VOL_SPOOL),target=/var/spool/asterisk \
  --mount type=volume,source=$(VOL_LOG),target=/var/log/asterisk \
  $(APP_IMAGE):$(APP_TAG)

# ── Help ──────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Setup ─────────────────────────────────────────────────────────────────
.PHONY: env pull samples check-pin
env: ## Create .env from .env.example if missing
	@test -f $(ENV_FILE) || cp $(ROOT_ABS)/.env.example $(ENV_FILE)
	@echo "$(ENV_FILE) ready"

pull: ## Pull the pinned base image (digest verified by the registry)
	docker pull $(BASE_REF)

samples: ## Extract the base image's /etc/asterisk into conf/samples/ (reference)
	@mkdir -p $(HERE_ABS)/conf/samples
	-@docker rm -f ast-samples >/dev/null 2>&1
	docker create --name ast-samples $(BASE_REF) >/dev/null
	docker cp ast-samples:/etc/asterisk/. $(HERE_ABS)/conf/samples/
	docker rm -f ast-samples >/dev/null

DOCKERFILE_REF := $(shell sed -n 's/^ARG BASE_IMAGE=//p' $(HERE_ABS)/Dockerfile | head -1)

check-pin: ## Warn when .env and the Dockerfile default disagree
	@if [ "$(BASE_REF)" != "$(DOCKERFILE_REF)" ]; then \
	  echo "warning: .env pin differs from Dockerfile default"; \
	  echo "  .env       : $(BASE_REF)"; \
	  echo "  Dockerfile : $(DOCKERFILE_REF)"; \
	fi

# ── Build ─────────────────────────────────────────────────────────────────
.PHONY: build build-standalone build-realtime
build: check-pin ## Build the image (MODE from .env; override with MODE=realtime)
	docker build \
	 --build-arg BASE_IMAGE=$(BASE_REF) \
	 --build-arg MODE=$(MODE) \
	 -t $(APP_IMAGE):$(APP_TAG) \
	 $(HERE_ABS)

build-standalone: ## Build without database integration
	$(MAKE) build MODE=standalone

build-realtime: ## Build with PostgreSQL/ODBC integration
	$(MAKE) build MODE=realtime

# ── Run ───────────────────────────────────────────────────────────────────
.PHONY: ensure-image create up
ensure-image:
	@docker image inspect $(APP_IMAGE):$(APP_TAG) >/dev/null 2>&1 || { \
	  echo "image $(APP_IMAGE):$(APP_TAG) missing - building"; \
	  $(MAKE) --no-print-directory build; \
	}

create:
	$(DOCKER_RUN)

ifeq ($(MODE),realtime)
up: ## Start the container (realtime defers to the root Makefile)
	@echo "realtime mode needs postgres + backend: make -C $(ROOT_ABS) up"
else
up: ensure-image ## Start the container (create if missing, start if stopped)
	@state=$$(docker inspect -f '{{.State.Status}}' $(CONTAINER) 2>/dev/null || true); \
	if [ -z "$$state" ]; then \
	  echo "creating $(CONTAINER)"; \
	  $(MAKE) --no-print-directory create; \
	else \
	  current=$$(docker inspect -f '{{.Image}}' $(CONTAINER) 2>/dev/null || true); \
	  desired=$$(docker image inspect -f '{{.Id}}' $(APP_IMAGE):$(APP_TAG) 2>/dev/null || true); \
	  if [ -n "$$current" ] && [ -n "$$desired" ] && [ "$$current" != "$$desired" ]; then \
	    echo "note: container image differs; run 'make recreate' to apply $(APP_IMAGE):$(APP_TAG)"; \
	  fi; \
	  host=$$(docker inspect -f '{{.Config.Hostname}}' $(CONTAINER) 2>/dev/null || true); \
	  if [ -n "$$host" ] && [ "$$host" != "$(FQDN)" ]; then \
	    echo "note: container hostname is '$$host' (wanted '$(FQDN)'); run 'make recreate'"; \
	  fi; \
	  net=$$(docker inspect -f '{{.HostConfig.NetworkMode}}' $(CONTAINER) 2>/dev/null || true); \
	  if [ "$$net" != "host" ]; then \
	    echo "container uses network=$$net; recreating with host networking"; \
	    docker rm -f -v $(CONTAINER) >/dev/null; \
	    $(MAKE) --no-print-directory create; \
	  elif [ "$$state" = "running" ] || [ "$$state" = "restarting" ]; then \
	    echo "$(CONTAINER) is $$state (no action)"; \
	  elif [ "$$state" = "paused" ]; then \
	    echo "unpausing $(CONTAINER)"; \
	    docker unpause $(CONTAINER) >/dev/null; \
	  elif [ "$$state" = "dead" ] || [ "$$state" = "removing" ]; then \
	    echo "recreating $(CONTAINER) (state=$$state)"; \
	    docker rm -f -v $(CONTAINER) >/dev/null 2>&1 || true; \
	    $(MAKE) --no-print-directory create; \
	  else \
	    echo "starting $(CONTAINER) (state=$$state)"; \
	    if ! docker start $(CONTAINER) >/dev/null; then \
	      echo "start failed - recreating"; \
	      docker rm -f -v $(CONTAINER) >/dev/null 2>&1 || true; \
	      $(MAKE) --no-print-directory create; \
	    fi; \
	  fi; \
	fi
endif

.PHONY: down rm restart recreate rebuild
down: ## Stop the container if it exists (no-op otherwise)
	@state=$$(docker inspect -f '{{.State.Status}}' $(CONTAINER) 2>/dev/null || true); \
	if [ "$$state" = "running" ] || [ "$$state" = "paused" ] || [ "$$state" = "restarting" ]; then \
	  echo "stopping $(CONTAINER)"; \
	  docker stop $(CONTAINER) >/dev/null; \
	else \
	  echo "$(CONTAINER) not running"; \
	fi

rm: ## Remove the container (named volumes are kept)
	@if docker inspect $(CONTAINER) >/dev/null 2>&1; then \
	  docker rm -f -v $(CONTAINER) >/dev/null; \
	  echo "removed $(CONTAINER)"; \
	else \
	  echo "$(CONTAINER) not present"; \
	fi

restart: ## Restart the existing container (same image/config)
	@if docker inspect $(CONTAINER) >/dev/null 2>&1; then \
	  docker restart $(CONTAINER) >/dev/null; \
	  echo "restarted $(CONTAINER)"; \
	else \
	  echo "$(CONTAINER) not present - creating"; \
	  $(MAKE) --no-print-directory up; \
	fi

recreate: rm up ## Recreate with the current image/config (volumes kept)

rebuild: ## Rebuild the image and recreate the container (volumes kept)
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory recreate

# ── Inspect ───────────────────────────────────────────────────────────────
.PHONY: logs ps test cli shell rtp-check
logs: ## Follow container logs
	@docker inspect $(CONTAINER) >/dev/null 2>&1 || { echo "no $(CONTAINER); run 'make up'"; exit 1; }
	docker logs -f $(CONTAINER)

ps: ## Show the container, running or stopped
	@docker ps -a --filter name=^/$(CONTAINER)$$ --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

test: ## Smoke-test the running container
	@docker exec $(CONTAINER) true >/dev/null 2>&1 || { echo "$(CONTAINER) is not running - run 'make up'"; exit 1; }
	docker exec $(CONTAINER) asterisk -rx "core show version"
	docker exec $(CONTAINER) asterisk -rx "module show like odbc"
	docker exec $(CONTAINER) asterisk -rx "odbc show all"
	docker exec $(CONTAINER) asterisk -rx "pjsip show transports"
	docker exec $(CONTAINER) asterisk -rx "pjsip show endpoints"
	docker exec $(CONTAINER) asterisk -rx "rtp show settings"
	docker exec $(CONTAINER) asterisk -rx "http show status"
	docker exec $(CONTAINER) asterisk -rx "dialplan show internal"

rtp-check: ## Show the RTP range Asterisk actually bound
	docker exec $(CONTAINER) asterisk -rx "rtp show settings"

cli: ## Open the Asterisk CLI
	docker exec -it $(CONTAINER) asterisk -rvvv

shell: ## Open a shell inside the container
	docker exec -it $(CONTAINER) sh

# ── Firewall ──────────────────────────────────────────────────────────────
.PHONY: firewall firewall-off firewall-status run
firewall: ## Apply host firewall rules (FIREWALL_ENABLED/FIREWALL_MODE)
	@sh $(FIREWALL_SCRIPT) on

firewall-off: ## Remove the rules created by 'firewall'
	@sh $(FIREWALL_SCRIPT) off

firewall-status: ## Show the host firewall state for the PBX
	@sh $(FIREWALL_SCRIPT) status

run: firewall up ## Apply firewall rules, then start the PBX

# ── Cleanup ───────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove the container, built images and this mode's volumes
	-@docker rm -f -v $(CONTAINER) >/dev/null 2>&1 || true
	-@docker rmi $(APP_IMAGE):standalone $(APP_IMAGE):realtime >/dev/null 2>&1 || true
	-@docker volume rm $(VOL_LIB) $(VOL_KEYS) $(VOL_SOUNDS) $(VOL_PHONEPROV) $(VOL_SPOOL) $(VOL_LOG) >/dev/null 2>&1 || true
