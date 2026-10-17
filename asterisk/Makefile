# asterisk/Makefile
#
# Scope: this directory only. Builds and runs the PBX container in isolation.
# The repository-root Makefile drives the full stack (postgres, backend, dashboard):
#     make -C .. up     -> full stack
#     make up           -> this container only

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

SIP_PORT   := $(if $(strip $(SIP_PORT)),$(strip $(SIP_PORT)),5060)
RTP_RANGE  := $(if $(strip $(RTP_RANGE)),$(strip $(RTP_RANGE)),10000-10299)
HTTP_PORT  := $(if $(strip $(HTTP_PORT)),$(strip $(HTTP_PORT)),8088)
WSS_PORT   := $(if $(strip $(WSS_PORT)),$(strip $(WSS_PORT)),8089)

VOL_LIB    := asterisk-$(MODE)-lib
VOL_SPOOL  := asterisk-$(MODE)-spool
VOL_LOG    := asterisk-$(MODE)-log
VOL_KEYS      := asterisk-$(MODE)-keys
VOL_SOUNDS    := asterisk-$(MODE)-sounds
VOL_PHONEPROV := asterisk-$(MODE)-phoneprov

ENV_FLAG   := $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)

# ── Help ──────────────────────────────────────────────────────────────────
.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	 awk 'BEGIN{FS=":.*?## "};{printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ── Setup ─────────────────────────────────────────────────────────────────
.PHONY: env
env: ## Create .env from .env.example if missing
	@test -f $(ENV_FILE) || cp $(ROOT_ABS)/.env.example $(ENV_FILE)
	@echo "$(ENV_FILE) ready"

.PHONY: pull
pull: ## Pull the pinned base image (digest verified by the registry)
	docker pull $(BASE_REF)

.PHONY: samples
samples: ## Extract the base image's /etc/asterisk into conf/samples/ (reference)
	@mkdir -p $(HERE_ABS)/conf/samples
	-@docker rm -f ast-samples >/dev/null 2>&1
	docker create --name ast-samples $(BASE_REF) >/dev/null
	docker cp ast-samples:/etc/asterisk/. $(HERE_ABS)/conf/samples/
	docker rm -f ast-samples >/dev/null

DOCKERFILE_REF := $(shell sed -n 's/^ARG BASE_IMAGE=//p' $(HERE_ABS)/Dockerfile | head -1)

.PHONY: check-pin
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
	 --pull \
	 --build-arg BASE_IMAGE=$(BASE_REF) \
	 --build-arg MODE=$(MODE) \
	 -t $(APP_IMAGE):$(APP_TAG) \
	 $(HERE_ABS)

build-standalone: ## Build without database integration
	$(MAKE) build MODE=standalone

build-realtime: ## Build with PostgreSQL/ODBC integration
	$(MAKE) build MODE=realtime

# ── Run ───────────────────────────────────────────────────────────────────
.PHONY: up
up: ## Start the container (realtime defers to the root Makefile)
ifeq ($(MODE),realtime)
	@echo "realtime mode needs postgres + backend: make -C $(ROOT_ABS) up"
else
	docker run -d --name $(CONTAINER) --restart unless-stopped \
	 --publish $(SIP_PORT):5060/udp --publish $(SIP_PORT):5060/tcp \
	 --publish $(RTP_RANGE):$(RTP_RANGE)/udp \
	 --publish $(HTTP_PORT):8088 --publish $(WSS_PORT):8089 \
	 $(ENV_FLAG) \
	 --env RTP_RANGE=$(RTP_RANGE) \
	 --mount type=volume,source=$(VOL_LIB),target=/var/lib/asterisk \
	 --mount type=volume,source=$(VOL_KEYS),target=/var/lib/asterisk/keys \
	 --mount type=volume,source=$(VOL_SOUNDS),target=/var/lib/asterisk/sounds \
	 --mount type=volume,source=$(VOL_PHONEPROV),target=/var/lib/asterisk/phoneprov \
	 --mount type=volume,source=$(VOL_SPOOL),target=/var/spool/asterisk \
	 --mount type=volume,source=$(VOL_LOG),target=/var/log/asterisk \
	 $(APP_IMAGE):$(APP_TAG)
endif

.PHONY: down rm restart logs
down: ## Stop the container
	-docker stop $(CONTAINER)

rm: down ## Stop and delete the container (volumes are kept)
	-docker rm $(CONTAINER)

restart: down up ## Restart the container

logs: ## Follow container logs
	docker logs -f $(CONTAINER)

# ── Inspect ───────────────────────────────────────────────────────────────
.PHONY: ps test cli shell rtp-check
ps: ## Show container status
	docker ps --filter name=$(CONTAINER)

test: ## Smoke-test the running container
	docker exec $(CONTAINER) asterisk -rx "core show version"
	docker exec $(CONTAINER) asterisk -rx "module show like odbc"
	docker exec $(CONTAINER) asterisk -rx "odbc show all"
	docker exec $(CONTAINER) asterisk -rx "pjsip show endpoints"
	docker exec $(CONTAINER) asterisk -rx "rtp show settings"
	docker exec $(CONTAINER) asterisk -rx "dialplan show internal"

rtp-check: ## Show the RTP range Asterisk actually bound
	docker exec $(CONTAINER) asterisk -rx "rtp show settings"

cli: ## Open the Asterisk CLI
	docker exec -it $(CONTAINER) asterisk -rvvv

shell: ## Open a shell inside the container
	docker exec -it $(CONTAINER) sh

# ── Cleanup ───────────────────────────────────────────────────────────────
.PHONY: clean
clean: ## Remove built images and this mode's dev volumes
	-docker rmi $(APP_IMAGE):standalone $(APP_IMAGE):realtime
	-docker volume rm $(VOL_LIB) $(VOL_SPOOL) $(VOL_LOG)
	-docker volume rm $(VOL_LIB) $(VOL_KEYS) $(VOL_SOUNDS) $(VOL_PHONEPROV) $(VOL_SPOOL) $(VOL_LOG)
