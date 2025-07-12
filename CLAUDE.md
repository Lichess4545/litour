# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Django-based tournament management web application for the online chess tournaments. It manages chess tournaments, player registrations, team formations, game pairings, round scheduling, and score tracking.

## Technology Stack

- **Backend**: Django 4.2.x with Python 3.9+
- **Database**: PostgreSQL
- **Task Queue**: Celery 5.3.6 with Redis broker
- **Frontend**: jQuery 3.1.0, Bootstrap 3, Sass
- **Dependency Management**: Poetry
- **Task Runner**: Invoke

## Development Commands

### Common Development Tasks

```bash
# Database operations
invoke createdb         # Create new database
invoke migrate          # Run database migrations
invoke makemigrations   # Create new migrations

# Running the application
invoke runserver        # Run Django dev server on 0.0.0.0:8000
invoke runapiworker     # Run API worker on port 8880

# Dependency management
invoke update           # Update all dependencies to latest versions (alias: up)
poetry install          # Install dependencies
poetry add <package>    # Add new dependency

# Testing
invoke test             # Run all tests
invoke test --path heltour.tournament.tests.test_models # Run specific test module

# Static files
invoke compilestatic    # Compile static files
invoke collectstatic    # Collect static files

# Development utilities
invoke shell            # Start Django shell
invoke createsuperuser  # Create a Django superuser
invoke status           # Check git status (alias: st)
```


## Architecture & Code Structure

### Main Application Structure

- `heltour/` - Main Django application
  - `tournament/` - Core tournament management app containing models, views, admin customizations
  - `api_worker/` - Background API worker application
  - `settings*.py` - Environment-specific settings files
  - `local/` - Machine-specific local development settings

### Key Models (in `tournament/models.py`)

- `League`, `Season`, `Round` - Tournament structure
- `Player`, `Team`, `TeamMember` - Participant management
- `TeamPairing`, `PlayerPairing` - Game pairings
- `Registration`, `AlternateAssignment` - Registration system

### Environment Configuration

- Create a file in `heltour/local/` named after your hostname for local settings
- Environment variable `HELTOUR_ENV` controls which settings file is used
- Settings hierarchy: `settings.py` → environment-specific settings → local overrides

### External Service Integrations

- **Lichess API** - OAuth authentication and game data
- **Slack API** - Notifications
- **Google Sheets API** - Data export
- **Firebase Cloud Messaging** - Push notifications

## Code Style Guidelines

Follow `.editorconfig` settings:

- Python: 4 spaces indentation, max 100 chars per line
- HTML/SCSS: 4 spaces indentation
- JavaScript: 2 spaces for files under lib/
- UTF-8 encoding, LF line endings

## Testing

Tests are located in `heltour/tournament/tests/`. The project uses Django's unittest framework. Run specific test categories:

- Models: `test_models.py`
- Admin: `test_admin.py`
- API: `test_api.py`
- Views: `test_views.py`
- Background tasks: `test_tasks.py`

## Important Notes

- The application supports both team-based and individual (lone) tournament formats
- Celery workers handle background tasks like API syncing and notifications
- JaVaFo (Java tool) can be used for sophisticated pairing generation
- MyPy is configured with Django plugin for type checking
