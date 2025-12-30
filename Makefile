.PHONY: help install typecheck test test-cov build clean dev

# Default target
help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (cli + 6 stacks)
	@echo "Installing CLI dependencies..."
	cd cli && npm install
	@echo "Installing GCP stack dependencies..."
	cd gcp/bootstrap && npm install
	cd gcp/infrastructure && npm install
	cd gcp/app && npm install
	@echo "Installing Azure stack dependencies..."
	cd azure/bootstrap && npm install
	cd azure/infrastructure && npm install
	cd azure/app && npm install
	@echo "All dependencies installed."

typecheck: ## Type-check all TypeScript
	@echo "Type-checking CLI..."
	cd cli && npx tsc --noEmit
	@echo "Type-checking GCP stacks..."
	cd gcp/bootstrap && npx tsc --noEmit
	cd gcp/infrastructure && npx tsc --noEmit
	cd gcp/app && npx tsc --noEmit
	@echo "Type-checking Azure stacks..."
	cd azure/bootstrap && npx tsc --noEmit
	cd azure/infrastructure && npx tsc --noEmit
	cd azure/app && npx tsc --noEmit
	@echo "All type checks passed."

test: ## Run CLI unit tests
	cd cli && npm test

test-cov: ## Run tests with coverage (requires @vitest/coverage-v8)
	cd cli && npx vitest run --coverage

build: ## Build CLI for distribution
	cd cli && npm run build

clean: ## Remove build artifacts
	rm -rf cli/dist
	rm -rf cli/coverage
	find . -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean complete."

dev: ## Run CLI in development mode
	cd cli && npm run dev -- --help
