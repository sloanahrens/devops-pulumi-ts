.PHONY: help install lint typecheck test test-cov build clean dev

# Default target
help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (pnpm workspace)
	pnpm install

lint: ## Run ESLint on CLI source
	pnpm lint

typecheck: ## Type-check all TypeScript
	pnpm typecheck

test: ## Run all unit tests
	pnpm test

test-cli: ## Run CLI unit tests only
	pnpm test:cli

test-cov: ## Run CLI tests with coverage
	pnpm --filter cli run test:cov

build: ## Build CLI for distribution
	pnpm build

clean: ## Remove build artifacts
	rm -rf cli/dist
	rm -rf cli/coverage
	rm -rf node_modules
	@echo "Clean complete."

dev: ## Run CLI in development mode
	cd cli && npx tsx src/index.ts --help
