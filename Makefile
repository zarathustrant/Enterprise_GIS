SHELL := /bin/zsh

.PHONY: help bootstrap check-clean github-sync github-web deploy-local db-migrate seed-capabilities docker-up docker-up-build docker-down docker-logs docker-ps health

help:
	@echo "Enterprise GIS local Docker workflow"
	@echo ""
	@echo "Targets:"
	@echo "  make bootstrap      - create .env from .env.example if missing"
	@echo "  make check-clean    - fail if the repo has local uncommitted changes"
	@echo "  make github-sync    - fast-forward this clone to the latest GitHub commit"
	@echo "  make github-web     - sync from GitHub, then build and start the app"
	@echo "  make deploy-local   - alias for github-web"
	@echo "  make db-migrate     - apply idempotent migrations to enterprise-gis-db only"
	@echo "  make seed-capabilities - replace the isolated local QA sample dataset"
	@echo "  make docker-up      - start containers in detached mode"
	@echo "  make docker-up-build- rebuild and start containers in detached mode"
	@echo "  make docker-down    - stop containers"
	@echo "  make docker-logs    - follow compose logs"
	@echo "  make docker-ps      - show container status"
	@echo "  make health         - print local app endpoints"

bootstrap:
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; else echo ".env already exists"; fi

check-clean:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "Refusing to sync because this clone has local changes."; \
		echo "Commit, stash, or discard them before running make github-web."; \
		git status --short; \
		exit 1; \
	else \
		echo "Git working tree is clean."; \
	fi

github-sync: check-clean
	git fetch origin
	git pull --ff-only
	@echo "Synced to latest fast-forward commit from GitHub."

github-web: bootstrap github-sync
	docker compose up -d --build --remove-orphans
	$(MAKE) db-migrate
	@echo ""
	@echo "Enterprise GIS is starting from the latest GitHub commit."
	@echo "Frontend: http://localhost:5173"
	@echo "API health: http://localhost:5001/health"
	@echo "Postgres host port: 5433"
	@echo "Redis host port: 6380"
	@echo "Postgres volume is preserved: docker compose up/down does not remove it."

deploy-local: github-web

db-migrate:
	@docker compose ps --status running --services | grep -qx db || { echo "enterprise-gis-db is not running"; exit 1; }
	@for migration in database/migrations/*.sql; do \
		echo "Applying $$migration to enterprise_gis"; \
		docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d enterprise_gis < "$$migration" || exit 1; \
	done

seed-capabilities:
	@docker compose ps --status running --services | grep -qx api || { echo "enterprise-gis-api is not running"; exit 1; }
	docker compose exec -T api python - < scripts/seed_capability_layers.py

docker-up:
	docker compose up -d

docker-up-build:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-ps:
	docker compose ps

health:
	@echo "Frontend: http://localhost:5173"
	@echo "API health: http://localhost:5001/health"
	@echo "Postgres: localhost:5433"
	@echo "Redis: localhost:6380"
