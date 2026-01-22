# Feedback Form Application

Simple one-page React app with Express backend for submitting feedback.

## Quick Start

```bash
# Install dependencies
make install

# Start development servers (frontend + backend)
make dev
```

App will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Makefile Commands

- `make install` - Install all dependencies
- `make dev` - Start both frontend and backend
- `make server` - Start backend only
- `make client` - Start frontend only
- `make build` - Build for production

## API

**POST /api/feedback** - Submit feedback
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "rating": 5,
  "message": "Great service!"
}
```

## Features

- Form validation (client & server)
- All elements have `data-testid` attributes for testing
- Responsive design
