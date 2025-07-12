import os
import sys
from invoke import task
from pathlib import Path

# Get project root directory
PROJECT_ROOT = Path(__file__).parent.absolute()

# Note: .env file is automatically loaded by Django settings
# No need to load it here to avoid duplication


def project_relative(path):
    """Convert a relative path to an absolute path relative to the project root."""
    return str(PROJECT_ROOT / path)


def import_db_name():
    """Import database name from Django settings."""
    sys.path.insert(0, str(PROJECT_ROOT))
    from heltour.settings import DATABASES
    return DATABASES['default']['NAME']


def import_db_user():
    """Import database user from Django settings."""
    sys.path.insert(0, str(PROJECT_ROOT))
    from heltour.settings import DATABASES
    return DATABASES['default']['USER']


def get_password():
    """Import database password from Django settings."""
    sys.path.insert(0, str(PROJECT_ROOT))
    from heltour.settings import DATABASES
    return DATABASES['default']['PASSWORD']


@task
def update(c):
    """Update all dependencies to their latest versions using poetry."""
    c.run("poetry update")


@task
def up(c):
    """Alias for update - update all dependencies to their latest versions."""
    update(c)


@task
def createdb(c):
    """Create a new database for the project."""
    database_name = import_db_name()
    database_user = import_db_user()
    password = get_password()
    
    # Create database
    c.run(f"createdb -U {database_user} {database_name}", warn=True)
    
    # If password is set, we might need to handle it differently
    if password:
        print(f"Note: Database created. You may need to configure password access for user {database_user}")


@task
def runserver(c):
    """Run the Django development server on 0.0.0.0:8000."""
    manage_py = project_relative("manage.py")
    c.run(f"python {manage_py} runserver 0.0.0.0:8000")


@task
def runapiworker(c):
    """Run the API worker server on port 8880."""
    manage_py = project_relative("manage.py")
    with c.prefix("export HELTOUR_APP=API_WORKER"):
        c.run(f"python {manage_py} runserver 0.0.0.0:8880")


@task
def status(c):
    """Check git status of the repository."""
    c.run("git status")


@task
def st(c):
    """Alias for status - check git status of the repository."""
    status(c)


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


@task
def test(c, path=None):
    """Run Django tests. Optionally specify a specific test path."""
    manage_py = project_relative("manage.py")
    if path:
        c.run(f"python {manage_py} test {path}")
    else:
        c.run(f"python {manage_py} test")


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
    c.run(f"python {manage_py} createsuperuser")