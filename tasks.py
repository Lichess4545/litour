from invoke import task
from pathlib import Path

# Get project root directory
PROJECT_ROOT = Path(__file__).parent.absolute()

# Note: .env file is automatically loaded by Django settings
# No need to load it here to avoid duplication


def project_relative(path):
    """Convert a relative path to an absolute path relative to the project root."""
    return str(PROJECT_ROOT / path)


@task
def update(c):
    """Update all dependencies to their latest versions using poetry."""
    c.run("poetry update")


@task
def runserver(c):
    """Run the Django development server on 0.0.0.0:8000."""
    manage_py = project_relative("manage.py")
    c.run(f"python -u {manage_py} runserver 0.0.0.0:8000", pty=True)


@task
def runapiworker(c):
    """Run the API worker server on port 8880."""
    manage_py = project_relative("manage.py")
    with c.prefix("export HELTOUR_APP=API_WORKER"):
        c.run(f"python {manage_py} runserver 0.0.0.0:8880")


@task
def celery(c):
    """Run Celery worker for background tasks."""
    c.run("celery -A heltour worker -l info", pty=True)


@task
def migrate(c):
    """Run Django database migrations."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} migrate")


@task
def makemigrations(c):
    """Create new Django migrations."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} makemigrations")


@task
def shell(c):
    """Start Django shell."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} shell")


@task(help={'test': 'Specific test module, class, or method to run'})
def test(c, test=""):
    """Run Django tests. Optionally specify a specific test path."""
    manage_py = project_relative("manage.py")
    test_cmd = f"python {manage_py} test --settings=heltour.test_settings"
    if test:
        c.run(f"{test_cmd} {test}")
    else:
        c.run(test_cmd)


@task
def collectstatic(c):
    """Collect static files."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} collectstatic --noinput")


@task
def compilestatic(c):
    """Compile static files."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} compilestatic")


@task
def createsuperuser(c):
    """Create a Django superuser."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} createsuperuser", pty=True)


@task
def docker_up(c):
    """Start Docker Compose services (PostgreSQL, Redis, MailHog)."""
    c.run("docker compose up -d", pty=True)


@task
def docker_down(c):
    """Stop Docker Compose services."""
    c.run("docker compose down", pty=True)


@task
def docker_status(c):
    """Show status of Docker Compose services."""
    c.run("docker compose ps", pty=True)
