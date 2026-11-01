.PHONY: install build dev seed test lint fmt typecheck mongo up down logs vision

install:
	pnpm install
	pnpm --filter @smart-speed/shared build

build:
	pnpm build

dev:
	pnpm dev

seed:
	pnpm seed

test:
	pnpm test

lint:
	pnpm lint

fmt:
	pnpm format

typecheck:
	pnpm typecheck

# Local MongoDB without Docker (mongodb-memory-server binary)
mongo:
	pnpm dev:mongo

# Full stack: mongo + server + physical serial bridge + vision + web
up:
	docker compose --profile tools up -d --build

# Mongo + server + web only (bridge/vision run on the host)
up-min:
	docker compose up -d --build

down:
	docker compose --profile tools down

logs:
	docker compose logs -f --tail=100

vision:
	bash scripts/dev-vision.sh
