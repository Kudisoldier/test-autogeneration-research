.PHONY: install dev server client build help

help:
	@echo "Available commands:"
	@echo "  make install  - Install all dependencies (root + client)"
	@echo "  make dev      - Start both frontend and backend in development mode"
	@echo "  make server   - Start backend server only"
	@echo "  make client   - Start frontend dev server only"
	@echo "  make build    - Build frontend for production"

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
