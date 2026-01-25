.PHONY: install dev server client build test test:server test:client test:e2e help

help:
	@echo "Available commands:"
	@echo "  make install     - Install all dependencies (root + client)"
	@echo "  make dev         - Start both frontend and backend in development mode"
	@echo "  make server      - Start backend server only"
	@echo "  make client      - Start frontend dev server only"
	@echo "  make build       - Build frontend for production"
	@echo "  make test        - Run all tests (server + client)"
	@echo "  make test:server - Run server tests only"
	@echo "  make test:client - Run client tests only"
	@echo "  make test:e2e    - Run E2E tests"

install:
	@echo "Installing root dependencies..."
	npm install
	@echo "Installing client dependencies..."
	cd client && npm install
	@echo "Installation complete!"

dev:
	@echo "Starting development servers..."
	npm run dev

server:
	@echo "Starting backend server..."
	npm run server

client:
	@echo "Starting frontend dev server..."
	npm run client

build:
	@echo "Building frontend for production..."
	npm run build

test:
	@echo "Running all tests..."
	npm run test

test:server:
	@echo "Running server tests..."
	npm run test:server

test:client:
	@echo "Running client tests..."
	cd client && npm test

test:e2e:
	@echo "Running E2E tests..."
	cd client && npm run test:e2e
