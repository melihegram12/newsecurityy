from pathlib import Path
import os


BASE_DIR = Path(__file__).resolve().parent.parent

# NOTE: Dev ortamı için env ile override edilebilir.
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-insecure-secret-key-change-me')
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'

if not DEBUG and SECRET_KEY == 'dev-insecure-secret-key-change-me':
    raise RuntimeError('Production ortaminda DJANGO_SECRET_KEY env degiskeni zorunludur!')

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1,0.0.0.0').split(',')
    if h.strip()
]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    # Local
    'core',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'security_api.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'security_api.wsgi.application'


db_host = os.environ.get('DB_HOST')
if db_host:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('DB_NAME', 'security'),
            'USER': os.environ.get('DB_USER', 'security'),
            'PASSWORD': os.environ.get('DB_PASSWORD', 'security'),
            'HOST': db_host,
            'PORT': os.environ.get('DB_PORT', '5432'),
        }
    }
else:
    # Local fallback (e.g. quick smoke tests without Docker)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }


AUTH_PASSWORD_VALIDATORS = []
if not DEBUG:
    AUTH_PASSWORD_VALIDATORS = [
        {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
        {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
        {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
        {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
    ]


LANGUAGE_CODE = 'tr-tr'
TIME_ZONE = os.environ.get('DJANGO_TIME_ZONE', 'Europe/Istanbul')
USE_I18N = True
USE_TZ = True


STATIC_URL = 'static/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}

SIMPLE_JWT = {
    # defaults are OK; keep explicit for clarity
    'AUTH_HEADER_TYPES': ('Bearer',),
}

LOCAL_SYNC_API_KEY = os.environ.get('LOCAL_SYNC_API_KEY', '')

# --- Production güvenlik ayarlari ---
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'


_cors_env = os.environ.get('CORS_ALLOWED_ORIGINS', '')
_cors_list = [o.strip() for o in _cors_env.split(',') if o.strip()]

if _cors_list:
    CORS_ALLOWED_ORIGINS = _cors_list
elif DEBUG:
    # Dev ortamında env yoksa localhost'a izin ver
    CORS_ALLOWED_ORIGINS = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
    ]
else:
    CORS_ALLOWED_ORIGINS = []
