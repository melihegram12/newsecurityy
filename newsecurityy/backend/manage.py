#!/usr/bin/env python
import os
import sys
from pathlib import Path


def main():
    # Make the behavior consistent regardless of where manage.py is invoked from.
    # This fixes `python backend/manage.py test` discovering 0 tests when run from repo root.
    base_dir = Path(__file__).resolve().parent
    try:
        os.chdir(base_dir)
    except OSError:
        # If we can't chdir (very unlikely), continue; Django will still run.
        pass

    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'security_api.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
