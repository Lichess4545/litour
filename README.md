# heltour
League management software for chess leagues on Lichess.

# Quick Start

## Prerequisites
* Docker and Docker Compose
* Nix (for development environment)

## Development Setup

```bash
# 1. Start the required services (PostgreSQL, Redis, MailHog)
docker-compose up -d

# 2. Copy the development environment file
cp .env.dev .env

# 3. Enter the nix development environment
nix develop

# 4. Run database migrations
invoke migrate

# 5. Create a superuser account
invoke createsuperuser

# 6. Start the development server
invoke runserver
```

The site will be available at http://localhost:8000

### Additional Services
- **MailHog Web UI**: http://localhost:8025 (view sent emails)
- **API Worker** (optional): `invoke runapiworker` (in another terminal)
- **Celery Worker** (optional): `celery -A heltour worker -l info` (in another terminal)

## Development Tips

- Ensure that your editor has an [EditorConfig plugin](https://editorconfig.org/#download) enabled.
- JaVaFo pairing tool is included in `thirdparty/javafo.jar` (already configured in `.env.dev`)

## Stopping Services

```bash
# Stop services but keep data
docker-compose down

# Stop services and remove all data
docker-compose down -v
```
